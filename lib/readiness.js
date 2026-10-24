// Readiness checklist shared by `init` and `doctor`: what is set up, what is missing, the exact command for each.
// Pure observation: nothing is changed here. No network except through the injected runner (gh), never in CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ghInstalled, originRepo, protectionStatus } from './branch-protection.js';
import { checkMissingSkills } from './sync-skills.js';

/** @typedef {{ id: string, label: string, state: 'ok' | 'missing' | 'n/a', detail: string, command?: string, optional?: boolean }} ReadinessItem */

const exists = (/** @type {string} */ f) => fs.access(f).then(() => true, () => false);

const OPTIONAL = [
  { id: 'sast', label: 'SAST rules (Semgrep)', file: '.semgrep/standards.yml', add: 'sast', what: 'finds missing auth guards and unsafe HTML' },
  { id: 'sca', label: 'Dependency audit (SCA)', file: '.github/workflows/standards-sca.yml', add: 'sca', what: 'npm audit on every PR' },
  { id: 'mutation', label: 'Mutation testing', file: 'stryker.config.mjs', add: 'mutation', what: 'shows which tests do not really protect the code' },
  { id: 'dast', label: 'DAST (OWASP ZAP)', file: '.github/workflows/standards-dast.yml', add: 'dast', what: 'nightly passive scan of a staging site' },
];

/**
 * @param {{ targetDir: string, homeDir: string, run: import('./branch-protection.js').Run, ci: boolean }} o
 * @returns {Promise<ReadinessItem[]>}
 */
export async function collectReadiness({ targetDir, homeDir, run, ci }) {
  const at = (/** @type {string} */ rel) => path.join(targetDir, rel);
  /** @type {ReadinessItem[]} */
  const items = [];
  const add = (/** @type {ReadinessItem} */ i) => items.push(i);

  // GitHub side: needs git and gh; skipped entirely in CI.
  const remote = ci ? null : await originRepo(run);
  let remoteSet = false;
  if (!ci) remoteSet = (await run('git', ['remote', 'get-url', 'origin'])).code === 0;
  add(ci
    ? { id: 'git-remote', label: 'Git remote', state: 'n/a', detail: 'not checked in CI' }
    : remoteSet
      ? { id: 'git-remote', label: 'Git remote', state: 'ok', detail: remote ? `origin = ${remote.owner}/${remote.repo}` : 'origin is set (not a github.com remote)' }
      : { id: 'git-remote', label: 'Git remote', state: 'missing', detail: 'the code is not on a remote yet', command: 'git remote add origin https://github.com/<owner>/<repo>.git' });

  const hasGh = ci ? false : await ghInstalled(run);
  add(ci
    ? { id: 'gh-installed', label: 'GitHub CLI (gh)', state: 'n/a', detail: 'not checked in CI' }
    : hasGh
      ? { id: 'gh-installed', label: 'GitHub CLI (gh)', state: 'ok', detail: 'installed' }
      : { id: 'gh-installed', label: 'GitHub CLI (gh)', state: 'missing', detail: 'needed to open pull requests and set branch protection from the terminal', command: 'brew install gh' });

  const authed = hasGh && (await run('gh', ['auth', 'status'])).code === 0;
  add(ci
    ? { id: 'gh-auth', label: 'gh signed in', state: 'n/a', detail: 'not checked in CI' }
    : authed
      ? { id: 'gh-auth', label: 'gh signed in', state: 'ok', detail: 'authenticated' }
      : { id: 'gh-auth', label: 'gh signed in', state: 'missing', detail: 'one time, browser or device flow', command: 'gh auth login' });

  if (ci || !remote || !authed) {
    add({ id: 'branch-protection', label: 'Branch protection', state: 'n/a', detail: ci ? 'not checked in CI' : 'needs a GitHub remote and a signed-in gh', command: 'npx oneup-standards protect-branch' });
  } else {
    const st = await protectionStatus(run, remote);
    const text = { ok: 'pull request and status checks required', unprotected: 'default branch is not protected', 'no-pr': 'no pull request required', 'no-checks': 'no status checks required', unknown: 'could not be read (admin rights?)' }[st.status];
    add({ id: 'branch-protection', label: 'Branch protection', state: st.status === 'ok' ? 'ok' : st.status === 'unknown' ? 'n/a' : 'missing', detail: text, command: st.status === 'ok' ? undefined : 'npx oneup-standards protect-branch' });
  }

  const missingSkills = await checkMissingSkills({ homeDir });
  add(missingSkills.length === 0
    ? { id: 'skills', label: 'AI skills', state: 'ok', detail: 'installed' }
    : { id: 'skills', label: 'AI skills', state: 'missing', detail: `${missingSkills.length} required skill(s) not installed`, command: 'npx oneup-standards sync-skills' });

  const hooks = (await exists(at('.husky/pre-commit'))) && (await exists(at('.husky/pre-push')));
  add(hooks
    ? { id: 'hooks', label: 'Git hooks', state: 'ok', detail: 'pre-commit and pre-push installed' }
    : { id: 'hooks', label: 'Git hooks', state: 'missing', detail: 'secrets and forbidden files are not checked before commit', command: 'npx oneup-standards init' });
  const ciFile = await exists(at('.github/workflows/ci.yml'));
  add(ciFile
    ? { id: 'ci', label: 'CI workflow', state: 'ok', detail: '.github/workflows/ci.yml' }
    : { id: 'ci', label: 'CI workflow', state: 'missing', detail: 'no automatic checks on pull requests', command: 'npx oneup-standards init' });
  const tpl = (await exists(at('.github/pull_request_template.md'))) || (await exists(at('.github/PULL_REQUEST_TEMPLATE.md'))) || (await exists(at('docs/pull_request_template.md')));
  add(tpl
    ? { id: 'pr-template', label: 'PR template', state: 'ok', detail: 'present' }
    : { id: 'pr-template', label: 'PR template', state: 'missing', detail: 'pull requests carry no risk tier or checklist', command: 'npx oneup-standards upgrade' });

  for (const o of OPTIONAL) {
    const present = await exists(at(o.file));
    add({ id: o.id, label: o.label, state: present ? 'ok' : 'missing', optional: true, detail: present ? 'installed, report only until you set the repository variable' : `optional: ${o.what}; report only until you set the repository variable`, command: present ? undefined : `npx oneup-standards add ${o.add}` });
  }
  return items;
}

/** @param {ReadinessItem[]} items */
export function formatReadiness(items) {
  const lines = ['Readiness checklist (OK / missing / n/a):'];
  for (const i of items) {
    lines.push(`  ${i.state.padEnd(8)} ${i.label.padEnd(24)} ${i.detail}`);
    if (i.state === 'missing' && i.command) lines.push(`  ${''.padEnd(8)} ${''.padEnd(24)} -> ${i.command}`);
  }
  lines.push('', 'Daily flow: `npx oneup-standards pr` opens the pull request; after you merged it on GitHub run `npx oneup-standards finish` to update main and delete the finished branch.');
  return lines.join('\n');
}

/** What only the human can do. @param {ReadinessItem[]} items @returns {string[]} */
export function humanTodo(items) {
  const state = (/** @type {string} */ id) => items.find((i) => i.id === id)?.state;
  /** @type {string[]} */
  const todo = [];
  if (state('gh-installed') !== 'ok' || state('gh-auth') !== 'ok') {
    todo.push('Without gh, set branch protection by hand: GitHub repo > Settings > Branches > Add branch protection rule on the default branch: require a pull request, require status checks, block force pushes.');
  }
  const variables = { sast: 'STANDARDS_SAST_BLOCKING', sca: 'STANDARDS_SCA_BLOCKING', mutation: 'STANDARDS_MUTATION_BREAK', dast: 'STANDARDS_DAST_BLOCKING' };
  const installed = Object.keys(variables).filter((id) => state(id) === 'ok');
  if (installed.length > 0) {
    todo.push(`Optional tools only report until you switch them to blocking: GitHub repo > Settings > Secrets and variables > Actions > Variables: ${installed.map((id) => `${variables[/** @type {keyof typeof variables} */ (id)]}=true`).join(', ')}.`);
  }
  if (state('dast') === 'ok') todo.push('DAST needs a staging URL (never production) in the secret or variable DAST_TARGET_URL.');
  todo.push('Database and storage rules are deployed by a human, never by an agent.');
  todo.push('You merge pull requests yourself; agents only open them.');
  return todo;
}
