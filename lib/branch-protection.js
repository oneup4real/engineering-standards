// GitHub branch protection: `protect-branch` command and the `doctor` hint. All process calls go through
// an injectable runner `(cmd, args, { input? }) => { code, stdout, stderr }` so tests never touch git or gh.

/** @typedef {(cmd: string, args: string[], opts?: { input?: string }) => Promise<{ code: number, stdout: string, stderr: string }>} Run */
/** @typedef {{ owner: string, repo: string }} Repo */

/** @param {string} url @returns {Repo | null} owner and repo of a github.com remote (https, scp-style ssh, ssh://) */
export function parseRemote(url) {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** @param {{ checks: string[], approvals: number, includeAdmins: boolean }} o */
export function buildPayload({ checks, approvals, includeAdmins }) {
  return {
    required_status_checks: checks.length > 0 ? { strict: true, contexts: checks } : null,
    enforce_admins: includeAdmins,
    required_pull_request_reviews: { required_approving_review_count: approvals, dismiss_stale_reviews: true },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

/** @param {Run} run @returns {Promise<Repo | null>} */
export async function originRepo(run) {
  const r = await run('git', ['remote', 'get-url', 'origin']);
  return r.code === 0 ? parseRemote(r.stdout) : null;
}

/** @param {Run} run */
export const ghInstalled = async (run) => (await run('gh', ['--version'])).code === 0;

/** @param {Repo} repo @param {string} branch */
const endpoint = ({ owner, repo }, branch) => `repos/${owner}/${repo}/branches/${branch.split('/').map(encodeURIComponent).join('/')}/protection`;

/**
 * Names of the check runs on the latest commit of the branch.
 * @param {Run} run @param {Repo} repo @param {string} branch @returns {Promise<string[]>}
 */
export async function discoverChecks(run, { owner, repo }, branch) {
  const r = await run('gh', ['api', `repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`, '--jq', '.check_runs[].name']);
  if (r.code !== 0) return [];
  return [...new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean))];
}

/** @param {string[]} args @param {string} flag */
const option = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const LIMITS = 'Limits: you need admin rights on the repository; private repositories need a paid GitHub plan (Pro, Team or Enterprise) for branch protection.';

/**
 * @param {string[]} args
 * @param {{ stdout: (s: string) => void, stderr: (s: string) => void }} io
 * @param {{ run: Run }} deps
 */
export async function runProtectBranch(args, io, { run }) {
  const branch = option(args, '--branch') ?? 'main';
  const approvalsText = option(args, '--approvals') ?? '0';
  const approvals = Number(approvalsText);
  if (!/^\d+$/.test(approvalsText) || approvals > 6) {
    io.stderr('✖ --approvals must be a whole number from 0 to 6.\n');
    return 2;
  }
  const repo = await originRepo(run);
  if (!repo) {
    io.stderr('✖ No GitHub remote found: `git remote get-url origin` must be https://github.com/<owner>/<repo> or git@github.com:<owner>/<repo>.\n');
    return 2;
  }
  const apply = args.includes('--apply');
  const hasGh = await ghInstalled(run);
  if (apply) {
    if (!hasGh) {
      io.stderr('✖ The GitHub CLI (gh) is not installed. Install it from https://cli.github.com, run `gh auth login`, then retry. Or use the click path from the dry run.\n');
      return 2;
    }
    if ((await run('gh', ['auth', 'status'])).code !== 0) {
      io.stderr('✖ gh is not authenticated. Run `gh auth login`, then retry.\n');
      return 2;
    }
  }

  const given = option(args, '--checks');
  const checks = given !== undefined ? given.split(',').map((s) => s.trim()).filter(Boolean) : hasGh ? await discoverChecks(run, repo, branch) : [];
  const payload = buildPayload({ checks, approvals, includeAdmins: args.includes('--include-admins') });
  const target = endpoint(repo, branch);

  if (checks.length === 0) {
    io.stdout(`⚠ No required status checks: pass --checks <name,name> (names as shown in the pull request checks list). Without them a red CI does not block the merge.\n`);
  }
  if (!apply) {
    io.stdout(`Dry run, nothing changed. Re-run with --apply to send this.\n\nPUT ${target}\n${JSON.stringify(payload, null, 2)}\n\n`);
    io.stdout(`Same by hand: GitHub repo > Settings > Branches > Add branch protection rule, pattern "${branch}": require a pull request before merging (${approvals} approval${approvals === 1 ? '' : 's'}), require status checks to pass${checks.length ? ` (${checks.join(', ')})` : ''} and branches up to date, ${payload.enforce_admins ? 'do not allow bypassing (applies to admins)' : 'admins may bypass (add --include-admins to apply it to them too)'}, no force pushes, no deletions.\n${LIMITS}\n`);
    return 0;
  }

  const r = await run('gh', ['api', '-X', 'PUT', target, '--input', '-'], { input: JSON.stringify(payload) });
  if (r.code !== 0) {
    io.stderr(`✖ GitHub refused the change:\n${r.stderr.trim() || r.stdout.trim()}\n${LIMITS}\n`);
    return 1;
  }
  io.stdout(`✔ Applied branch protection on ${repo.owner}/${repo.repo}@${branch}: pull request required (${approvals} approvals), ${checks.length} status check(s), force push and deletion blocked.\n`);
  return 0;
}

/**
 * Doctor hint about the default branch protection. Never throws, never a failure; silent in CI and without a GitHub remote.
 * @param {{ run: Run, ci: boolean }} o @returns {Promise<{ id: string, message: string } | null>}
 */
export async function protectionHint({ run, ci }) {
  if (ci) return null;
  const repo = await originRepo(run);
  if (!repo) return null;
  const id = 'branch-protection';
  const cmd = 'Run `npx oneup-standards protect-branch` (dry run first), or GitHub > Settings > Branches > Add branch protection rule.';
  if (!(await ghInstalled(run)) || (await run('gh', ['auth', 'status'])).code !== 0) {
    return { id, message: `Cannot check the branch protection of the default branch (gh missing or not signed in). Agents must not push to it; GitHub should enforce that. ${cmd}` };
  }
  const st = await protectionStatus(run, repo);
  if (st.status === 'unknown') return null;
  const b = st.branch;
  if (st.status === 'unprotected') return { id, message: `The default branch "${b}" is not protected: anyone with write access can push to it, and many projects deploy from it. ${cmd}` };
  if (st.status === 'no-pr') return { id, message: `"${b}" does not require a pull request, so a direct push goes live. ${cmd}` };
  if (st.status === 'no-checks') return { id, message: `"${b}" requires a pull request but no status checks, so a red CI does not block the merge. ${cmd}` };
  return null;
}

/**
 * Protection of the default branch via gh. 'unknown' = query failed for another reason (e.g. no admin rights).
 * @param {Run} run @param {Repo} repo
 * @returns {Promise<{ status: 'ok' | 'unprotected' | 'no-pr' | 'no-checks' | 'unknown', branch: string }>}
 */
export async function protectionStatus(run, repo) {
  const info = await run('gh', ['api', `repos/${repo.owner}/${repo.repo}`, '--jq', '.default_branch']);
  const branch = info.stdout.trim();
  if (info.code !== 0 || !branch) return { status: 'unknown', branch: '' };
  const r = await run('gh', ['api', endpoint(repo, branch)]);
  if (r.code !== 0) return { status: /404|not protected/i.test(r.stderr + r.stdout) ? 'unprotected' : 'unknown', branch };
  try {
    const p = JSON.parse(r.stdout);
    if (!p.required_pull_request_reviews) return { status: 'no-pr', branch };
    const s = p.required_status_checks;
    if (!s || ((s.contexts?.length ?? 0) === 0 && (s.checks?.length ?? 0) === 0)) return { status: 'no-checks', branch };
  } catch {
    return { status: 'unknown', branch };
  }
  return { status: 'ok', branch };
}
