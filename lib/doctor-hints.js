// Optional observations for `doctor`. Hints never fail a check and never change the exit code:
// they point at opt-in tooling and at drift that costs tokens or trust, with the reason.
import fs from 'node:fs/promises';
import path from 'node:path';
import { BEGIN_MARKER } from './managed-block.js';
import { parse } from 'yaml';
import { protectionHint } from './branch-protection.js';

/** @typedef {{ id: string, message: string }} Hint */

// Heading that only the full standard has; the short global bootstrap lacks it.
const FULL_STANDARD_MARKER = '## 0. Mandatory Pre-Flight';

/** @param {string} file */
const readOrNull = (file) => fs.readFile(file, 'utf8').catch(() => null);
/** @param {string} file */
const exists = (file) => fs.access(file).then(() => true, () => false);

/** @param {string} dir @returns {Promise<string[]>} markdown files, one level deep */
async function markdownFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await fs.readdir(full).catch(() => [])).filter((n) => n.endsWith('.md')).map((n) => path.join(full, n)));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** @param {string} targetDir @returns {Promise<string>} all workflow files, concatenated */
async function workflowText(targetDir) {
  const dir = path.join(targetDir, '.github', 'workflows');
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /\.ya?ml$/.test(n));
  return (await Promise.all(names.map((n) => readOrNull(path.join(dir, n))))).filter(Boolean).join('\n');
}

/** Whether a workflow input is on; unknown expressions count as on. @param {unknown} v @param {boolean} dflt */
const flag = (v, dflt) => (v === undefined ? dflt : typeof v === 'string' ? v.trim().toLowerCase() !== 'false' : Boolean(v));

/**
 * Which scans the workflows provide: the reusable security.yml (semgrep/codeql inputs, audit job always) or own setups.
 * @param {string} targetDir @param {string} workflows
 * @returns {Promise<{ sast: boolean, sca: boolean }>}
 */
async function securityScans(targetDir, workflows) {
  let sast = /codeql-action|\bsemgrep\b/i.test(workflows.replace(/uses:[^\n]*security\.yml@\S+/g, '')) || (await exists(path.join(targetDir, '.semgrep', 'standards.yml')));
  let sca = /npm audit|audit-ci|osv-scanner|dependency-review-action/.test(workflows);
  const dir = path.join(targetDir, '.github', 'workflows');
  for (const name of (await fs.readdir(dir).catch(() => [])).filter((n) => /\.ya?ml$/.test(n))) {
    let doc;
    try { doc = parse((await readOrNull(path.join(dir, name))) ?? ''); } catch { continue; }
    for (const job of Object.values(doc?.jobs ?? {})) {
      const uses = /** @type {any} */ (job)?.uses;
      if (typeof uses !== 'string' || !/security\.yml(@|$)/.test(uses)) continue;
      sca = true;
      const inputs = /** @type {any} */ (job).with ?? {};
      if (flag(inputs.codeql, true) || flag(inputs.semgrep, false)) sast = true;
    }
  }
  return { sast, sca };
}

/** Lines of the project's pre-commit hook that repeat what pre-push already runs. @param {string} targetDir */
async function duplicatePreCommitLines(targetDir) {
  const text = await readOrNull(path.join(targetDir, '.husky', 'pre-commit'));
  if (!text) return [];
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')
    && !/oneup-standards\s+hook/.test(l)
    && /(^|[\s;&|])(?:npx\s+(?:--no-install\s+)?)?tsc(\s|$)|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|test:\w+)\b|\bvitest\b|\bjest\b/.test(l));
}

/**
 * @param {{ targetDir: string, homeDir: string, pkg: Record<string, any> | null, run?: import('./branch-protection.js').Run, ci?: boolean }} opts
 * @returns {Promise<Hint[]>}
 */
export async function collectHints({ targetDir, homeDir, pkg, run, ci = false }) {
  const at = (/** @type {string} */ rel) => path.join(targetDir, rel);
  /** @type {Hint[]} */
  const hints = [];
  const workflows = await workflowText(targetDir);

  // Specs for T3 work: tier and abuse cases (skill factory-review, gate G1).
  const specs = [...await markdownFiles(at('docs/superpowers/specs')), ...await markdownFiles(at('docs/specs'))];
  if (specs.length > 0) {
    const texts = await Promise.all(specs.map((f) => fs.readFile(f, 'utf8')));
    if (!texts.some((t) => /^\s*(?:#+\s*)?(?:\*\*)?(?:risk\s+)?tier(?:\*\*)?\s*:?\s*\**\s*T[0-3]\b/im.test(t) || /^#+\s*risk tier/im.test(t))) {
      hints.push({ id: 'spec-risk-tier', message: `${specs.length} spec(s) found, none states a risk tier (e.g. "Risk tier: T3"). The tier decides builder, reviewers and approval; see the factory-review skill.` });
    }
    if (!texts.some((t) => /^#+\s*abuse cases?\b/im.test(t)) && !specs.some((f) => /abuse-cases/i.test(path.basename(f)))) {
      hints.push({ id: 'spec-abuse-cases', message: 'No spec has an "Abuse cases" heading or abuse-cases file. T3 specs (security, money, roles, public endpoints) list abuse cases and each becomes a test; template: skills/factory-review/references/abuse-cases-template.md.' });
    }
  }

  // Security scans: one pipeline, the shared security.yml (gitleaks, audit, Semgrep or CodeQL, dependency review).
  const scans = await securityScans(targetDir, workflows);
  if (!scans.sast) {
    hints.push({ id: 'sast', message: 'No SAST found: security.yml is not used with `semgrep: true` or `codeql: true`, and there is no own CodeQL or Semgrep setup. Call the shared workflow (`security.yml@v1`, input `semgrep: true`) in .github/workflows/ci.yml.' });
  }
  if (!scans.sca) {
    hints.push({ id: 'sca', message: 'No dependency audit (SCA) found. The shared `security.yml@v1` workflow runs `npm audit --omit=dev`; call it from .github/workflows/ci.yml.' });
  }
  // Opt-in mutation testing (npx oneup-standards add mutation).
  const hasStryker = (await Promise.all(['stryker.config.mjs', 'stryker.config.js', 'stryker.config.cjs', 'stryker.conf.json'].map((f) => exists(at(f))))).some(Boolean)
    || Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).some((d) => d.startsWith('@stryker-mutator/'));
  if (!hasStryker) {
    hints.push({ id: 'mutation', message: 'Opt-in: no mutation testing (Stryker) configured. It shows which guards and calculations your tests do not really protect. `npx oneup-standards add mutation`' });
  }

  const duplicates = await duplicatePreCommitLines(targetDir);
  if (duplicates.length > 0) {
    hints.push({ id: 'hook-duplicate-checks', message: `.husky/pre-commit also runs checks that \`hook pre-push\` already runs (typecheck, tests), so every commit is slow and the work is done twice. Remove from .husky/pre-commit: ${duplicates.map((l) => `\`${l}\``).join(', ')}` });
  }

  // `npm run test:unit` must run the same test project as CI.
  const unit = /** @type {string | undefined} */ (pkg?.scripts?.['test:unit']);
  if (unit && /vitest/.test(workflows) && !/test:unit/.test(workflows)) {
    const project = unit.match(/--project[= ]+([\w:./-]+)/)?.[1];
    const ciProjects = new Set([...workflows.matchAll(/vitest[^\n]*?--project[= ]+([\w:./-]+)/g)].map((m) => m[1]));
    if (project ? !ciProjects.has(project) : ciProjects.size > 0) {
      hints.push({ id: 'test-project-mismatch', message: `\`npm run test:unit\` (${project ? `project "${project}"` : 'no --project'}) and the CI vitest step${ciProjects.size ? ` (${[...ciProjects].join(', ')})` : ' (no --project)'} look like different test projects. Heuristic: a green local run may not mean a green CI. Make CI call \`npm run test:unit\`.` });
    }
  }

  // The full standards text loaded twice costs tokens on every request. The short global bootstrap is fine.
  const globalAgents = await readOrNull(path.join(homeDir, '.agents', 'AGENTS.md'));
  const projectAgents = await readOrNull(at('AGENTS.md'));
  if (globalAgents?.includes(BEGIN_MARKER) && globalAgents.includes(FULL_STANDARD_MARKER) && projectAgents?.includes(BEGIN_MARKER)) {
    hints.push({ id: 'duplicate-standards', message: 'The full standards block is in this project\'s AGENTS.md and in ~/.agents/AGENTS.md, so agents read it twice (about 160 lines, i.e. tokens, on every request). Run `npx oneup-standards sync-agents --global`: it replaces the global copy with a short bootstrap and keeps your own text.' });
  }

  // factory-review skill present for the harnesses installed here.
  const harnessHomes = [path.join(homeDir, '.claude'), path.join(homeDir, '.gemini')];
  if ((await Promise.all(harnessHomes.map(exists))).some(Boolean)) {
    const copies = [path.join(homeDir, '.claude', 'skills'), path.join(homeDir, '.gemini', 'config', 'skills'), at('.claude/skills')];
    if (!(await Promise.all(copies.map((d) => exists(path.join(d, 'factory-review', 'SKILL.md'))))).some(Boolean)) {
      hints.push({ id: 'factory-review-skill', message: 'The factory-review skill (risk tiers, specialist reviewers) is not installed. `npx oneup-standards sync-skills`' });
    }
  }

  // Claude Code: block agents from merging pull requests (a human merges).
  const settingsTexts = (await Promise.all(['.claude/settings.json', '.claude/settings.local.json'].map((f) => readOrNull(at(f))))).filter((t) => t !== null);
  if (settingsTexts.length > 0 && !settingsTexts.some((t) => /gh\s+pr\s+merge/.test(t))) {
    hints.push({ id: 'agent-merge-deny', message: 'Claude Code settings exist but do not block merging. Add `Bash(gh pr merge:*)` to permissions.deny in .claude/settings.json so agents open pull requests but only a human merges.' });
  }

  // Agents push feature branches and open PRs; GitHub should enforce that for the default branch.
  if (run) {
    const protection = await protectionHint({ run, ci });
    if (protection) hints.push(protection);
  }
  return hints;
}
