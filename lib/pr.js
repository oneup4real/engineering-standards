// `oneup-standards pr`: opens the pull request for the current feature branch. Never merges, never enables auto-merge.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ghInstalled, originRepo } from './branch-protection.js';
import { readStandardsConfig } from './config.js';
import { classifyPaths } from './risk-tier.js';

/** @param {string[]} args @param {string} flag */
const option = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

/** @param {{ template: string | null, tier: { tier: string, reviewers: string[], humanApproval: boolean }, commits: string[] }} o */
export function buildBody({ template, tier, commits }) {
  const parts = [
    `## Risk tier (computed): ${tier.tier}`,
    '',
    `Reviewers: ${tier.reviewers.length > 0 ? tier.reviewers.join(', ') : 'none (tools only)'}`,
    `Human approval required: ${tier.humanApproval ? 'yes (T3: a human approves before merge)' : 'no'}`,
    '',
    '## Commits',
    '',
    ...commits.map((c) => `- ${c}`),
  ];
  if (template) parts.push('', template.trim());
  return `${parts.join('\n')}\n`;
}

/**
 * @param {string[]} args
 * @param {import('./cli.js').Io} io
 * @param {{ run: import('./branch-protection.js').Run }} deps
 */
export async function runPr(args, io, { run }) {
  const out = async (/** @type {string[]} */ a) => {
    const r = await run('git', a);
    return r.code === 0 ? r.stdout.trim() : '';
  };
  const branch = await out(['branch', '--show-current']);
  if (!branch) {
    io.stderr('✖ Not on a branch (detached HEAD). Switch to your feature branch first.\n');
    return 2;
  }
  const head = (await out(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '');
  const base = option(args, '--base') ?? (head || 'main');
  if (branch === base || (!head && ['main', 'master'].includes(branch))) {
    io.stderr(`✖ You are on the default branch "${branch}". Agents and humans open pull requests from a feature branch: git switch -c feat/<name>.\n`);
    return 2;
  }
  if (args.includes('--push')) {
    const push = await run('git', ['push', '-u', 'origin', branch]);
    if (push.code !== 0) {
      io.stderr(`✖ git push failed:\n${push.stderr.trim()}\n`);
      return 1;
    }
  }

  const range = `origin/${base}`;
  const commits = (await out(['log', '--format=%s', `${range}..HEAD`])).split('\n').filter(Boolean);
  const paths = (await out(['diff', '--name-only', '--diff-filter=ACMR', `${range}...HEAD`])).split('\n').filter(Boolean);
  const tier = classifyPaths(paths, await readStandardsConfig(io.cwd));
  const template = await fs.readFile(path.join(io.cwd, '.github', 'pull_request_template.md'), 'utf8').catch(() => null);
  const body = buildBody({ template, tier, commits });
  const title = option(args, '--title') ?? commits[commits.length - 1] ?? branch;

  const repo = await originRepo(run);
  const compare = repo ? `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : null;
  const manual = () => {
    if (compare) io.stdout(`\nOpen this link and paste the text below as the description:\n${compare}\n`);
    io.stdout(`\nTitle: ${title}\n\n${body}`);
  };

  const usable = (await ghInstalled(run)) && (await run('gh', ['auth', 'status'])).code === 0;
  if (!usable) {
    io.stdout('GitHub CLI missing or not signed in (`brew install gh`, `gh auth login`): printing the pull request text instead.\n');
    manual();
    return 0;
  }
  const create = await run('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body-file', '-', ...(args.includes('--draft') ? ['--draft'] : [])], { input: body });
  if (create.code !== 0) {
    io.stderr(`✖ gh pr create failed:\n${create.stderr.trim()}\n(Is the branch pushed? Add --push.)\n`);
    manual();
    return 1;
  }
  const url = create.stdout.trim().split('\n').pop();
  io.stdout(`✔ Pull request opened: ${url}\nA human reviews and merges it; this tool never merges.\n`);
  return 0;
}
