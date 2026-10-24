// Git hook logic. Side effects go through `deps` so the order and failure handling are testable.
import { findForbiddenFiles } from './forbidden-files.js';

/**
 * @typedef {{
 *   exec: (cmd: string, args: string[]) => Promise<{ code: number }>,
 *   which: (bin: string) => Promise<boolean>,
 *   stagedPaths: () => Promise<string[]>,
 *   readConfig?: () => Promise<any>,
 *   rulesFile?: () => Promise<string | null>,
 *   lockfileChanged?: () => Promise<boolean>,
 *   online?: () => Promise<boolean>,
 *   readStdin?: () => Promise<string>,
 *   defaultBranch?: () => Promise<string | null>,
 * }} HookDeps
 * @typedef {import('./cli.js').Io} Io
 */

/**
 * Pre-commit: forbidden files → secret scan → lint staged files → SAST on staged files (report-only unless hooks.sastBlocking).
 * Stops at the first failure.
 * @param {Io} io
 * @param {HookDeps} deps
 */
export async function preCommit(io, deps) {
  const config = deps.readConfig ? await deps.readConfig() : {};
  const ignore = config?.checkFiles?.ignore ?? config?.allowedFiles ?? [];
  const offenders = findForbiddenFiles(await deps.stagedPaths(), { ignore });
  if (offenders.length > 0) {
    io.stderr('✖ These files must not be committed:\n');
    for (const o of offenders) io.stderr(`  ${o.path}  → ${o.reason}\n`);
    io.stderr('Unstage them with: git restore --staged <file>\n');
    return 1;
  }

  if (!(await deps.which('gitleaks'))) {
    io.stderr('✖ gitleaks is not installed, so staged changes cannot be scanned for secrets.\n');
    io.stderr('  Install it once:  brew install gitleaks   (Windows: winget install gitleaks)\n');
    return 1;
  }
  if ((await deps.exec('gitleaks', ['protect', '--staged', '--redact', '--no-banner'])).code !== 0) {
    io.stderr('✖ gitleaks found a possible secret in your staged changes (see above). Remove it and rotate the secret if it was real.\n');
    return 1;
  }

  if ((await deps.exec('npx', ['--no-install', 'lint-staged'])).code !== 0) {
    io.stderr('✖ Lint failed on staged files (see above). Fix the reported problems and commit again.\n');
    return 1;
  }
  return sastStaged(io, deps, config);
}

const SAST_FILES = /\.(?:[cm]?[jt]sx?)$/;

/** SAST on staged code files with our local rules only (offline-safe). Report-only unless hooks.sastBlocking. */
async function sastStaged(/** @type {Io} */ io, /** @type {HookDeps} */ deps, /** @type {any} */ config) {
  const rules = deps.rulesFile ? await deps.rulesFile() : null;
  if (!rules) return 0;
  const files = (await deps.stagedPaths()).filter((f) => SAST_FILES.test(f));
  if (files.length === 0) return 0;
  if (!(await deps.which('semgrep'))) {
    io.stderr('ℹ SAST skipped (semgrep not installed): brew install semgrep\n');
    return 0;
  }
  const blocking = config?.hooks?.sastBlocking === true;
  const result = await deps.exec('semgrep', ['scan', '--config', rules, '--metrics=off', '--quiet', ...(blocking ? ['--error'] : []), ...files]);
  if (result.code === 0) return 0;
  if (blocking) {
    io.stderr('✖ SAST found problems in staged files (see above). Fix them, or suppress a reviewed one with `// nosemgrep: <rule id> - <reason>`.\n');
    return 1;
  }
  io.stderr('ℹ SAST reported findings above (report-only; set "hooks": { "sastBlocking": true } in .standardsrc.json to block).\n');
  return 0;
}

const ZERO_SHA = /^0+$/;

/**
 * Lines git writes to the pre-push hook on stdin: `<local ref> <local sha> <remote ref> <remote sha>`.
 * @param {string} text
 */
export function parsePushLines(text) {
  return text.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 4).map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha, deleted: ZERO_SHA.test(localSha) }));
}

/** Refuses pushes (and deletes) of the default branch unless the human override env is set or the guard is off. */
async function guardDefaultBranch(/** @type {Io} */ io, /** @type {HookDeps} */ deps, /** @type {ReturnType<typeof parsePushLines>} */ pushes) {
  const config = deps.readConfig ? await deps.readConfig() : {};
  if (config?.hooks?.protectDefaultBranch === false) return 0;
  const head = deps.defaultBranch ? await deps.defaultBranch() : null;
  const resolved = config?.hooks?.defaultBranch ?? head?.replace(/^refs\/remotes\/[^/]+\//, '') ?? 'main';
  const protectedRefs = new Set(['main', 'master', resolved].map((b) => `refs/heads/${b}`));
  const hit = pushes.find((p) => protectedRefs.has(p.remoteRef));
  if (!hit || io.env.ONEUP_ALLOW_DEFAULT_PUSH === '1') return 0;
  const branch = hit.remoteRef.slice('refs/heads/'.length);
  io.stderr(`✖ Direct pushes to ${branch} are blocked by the standards. Push a feature branch and open a pull request: npx oneup-standards pr. Humans can override once: ONEUP_ALLOW_DEFAULT_PUSH=1 git push ...\n`);
  return 1;
}

/**
 * Pre-push: default-branch guard (stdin) → typecheck → unit tests (once) → dependency audit when package-lock.json changed and the network is
 * reachable (report-only unless hooks.auditBlocking).
 * @param {Io} io
 * @param {HookDeps} deps
 */
export async function prePush(io, deps) {
  if (deps.readStdin) {
    const pushes = parsePushLines(await deps.readStdin());
    if ((await guardDefaultBranch(io, deps, pushes)) !== 0) return 1;
    // Only deletes and tags: no new branch code leaves the machine, nothing to typecheck or test.
    if (pushes.length > 0 && pushes.every((p) => p.deleted || !p.remoteRef.startsWith('refs/heads/'))) return 0;
  }
  if ((await deps.exec('npx', ['--no-install', 'tsc', '--noEmit'])).code !== 0) {
    io.stderr('✖ Type errors (see above). Fix them before pushing.\n');
    return 1;
  }
  if ((await deps.exec('npm', ['test', '--silent'])).code !== 0) {
    io.stderr('✖ Tests failed (see above). Fix them before pushing.\n');
    return 1;
  }
  if (!deps.lockfileChanged || !(await deps.lockfileChanged())) return 0;
  if (deps.online && !(await deps.online())) {
    io.stderr('ℹ Dependency audit skipped (offline); CI runs it.\n');
    return 0;
  }
  const config = deps.readConfig ? await deps.readConfig() : {};
  const level = config?.hooks?.auditLevel ?? 'high';
  if ((await deps.exec('npm', ['audit', '--omit=dev', `--audit-level=${level}`])).code === 0) return 0;
  if (config?.hooks?.auditBlocking === true) {
    io.stderr(`✖ npm audit found vulnerabilities at ${level} or above (see above). Update the dependency before pushing.\n`);
    return 1;
  }
  io.stderr(`ℹ npm audit reported findings at ${level} or above (report-only; set "hooks": { "auditBlocking": true } in .standardsrc.json to block).\n`);
  return 0;
}
