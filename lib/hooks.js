// Git hook logic. Side effects go through `deps` so the order and failure handling are testable.
import { findForbiddenFiles } from './forbidden-files.js';

/**
 * @typedef {{
 *   exec: (cmd: string, args: string[]) => Promise<{ code: number }>,
 *   which: (bin: string) => Promise<boolean>,
 *   stagedPaths: () => Promise<string[]>,
 * }} HookDeps
 * @typedef {import('./cli.js').Io} Io
 */

/**
 * Pre-commit: forbidden files → secret scan → lint staged files. Stops at the first failure.
 * @param {Io} io
 * @param {HookDeps} deps
 */
export async function preCommit(io, deps) {
  const offenders = findForbiddenFiles(await deps.stagedPaths());
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
  return 0;
}

/**
 * Pre-push: typecheck → unit tests.
 * @param {Io} io
 * @param {HookDeps} deps
 */
export async function prePush(io, deps) {
  if ((await deps.exec('npx', ['--no-install', 'tsc', '--noEmit'])).code !== 0) {
    io.stderr('✖ Type errors (see above). Fix them before pushing.\n');
    return 1;
  }
  if ((await deps.exec('npm', ['test', '--silent'])).code !== 0) {
    io.stderr('✖ Tests failed (see above). Fix them before pushing.\n');
    return 1;
  }
  return 0;
}
