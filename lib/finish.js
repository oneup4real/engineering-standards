// `oneup-standards finish`: after a pull request was merged on GitHub, bring local git up to date and delete finished branches.
// Dry run by default. A branch is deleted only when it is proven done; unproven branches are never touched.
import { ghInstalled } from './branch-protection.js';

/** @typedef {import('./branch-protection.js').Run} Run */
/** @typedef {{ done: boolean, how?: 'merged' | 'squash', reason: string }} Verdict */

/** @param {string[]} args @param {string} flag */
const option = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

/**
 * @param {string[]} args
 * @param {import('./cli.js').Io} io
 * @param {{ run: Run }} deps
 */
export async function runFinish(args, io, { run }) {
  const apply = args.includes('--apply');
  const withRemote = args.includes('--remote');
  const withWorktrees = args.includes('--worktrees');
  const git = (/** @type {string[]} */ a) => run('git', a);
  const text = async (/** @type {string[]} */ a) => {
    const r = await git(a);
    return r.code === 0 ? r.stdout.trim() : '';
  };
  const out = (/** @type {string} */ s) => io.stdout(`${s}\n`);

  const dirty = await text(['status', '--porcelain']);
  if (dirty) {
    io.stderr(`✖ Uncommitted changes, nothing was changed. Commit or stash them first:\n${dirty}\n`);
    return 2;
  }

  const head = (await text(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '');
  const base = head || ((await git(['rev-parse', '--verify', '--quiet', 'refs/heads/main'])).code === 0 ? 'main' : 'master');
  const current = await text(['branch', '--show-current']);
  const target = option(args, '--branch') ?? (current !== base ? current : '');
  out(apply ? `Finishing (default branch: ${base})` : `Dry run, nothing is changed. Add --apply to do it. (default branch: ${base})`);

  const summary = { updated: /** @type {string[]} */ ([]), deleted: /** @type {string[]} */ ([]), kept: /** @type {string[]} */ ([]) };

  if (apply) {
    const fetch = await git(['fetch', '--prune']);
    if (fetch.code !== 0) {
      io.stderr(`✖ git fetch --prune failed:\n${fetch.stderr.trim()}\n`);
      return 1;
    }
    if (current !== base) {
      const sw = await git(['switch', base]);
      if (sw.code !== 0) {
        io.stderr(`✖ Could not switch to ${base}:\n${sw.stderr.trim()}\n(Is it checked out in another worktree? Run finish there.)\n`);
        return 1;
      }
    }
    const pull = await git(['pull', '--ff-only']);
    if (pull.code !== 0) {
      io.stderr(`✖ ${base} cannot fast-forward to origin/${base} (local commits on ${base}?). Nothing was deleted:\n${pull.stderr.trim()}\n`);
      return 1;
    }
    summary.updated.push(`${base} (fetched, fast-forwarded)`);
  } else {
    out(`would run: git fetch --prune; git switch ${base}; git pull --ff-only`);
  }

  const ref = apply ? base : `origin/${base}`;
  const gh = (await ghInstalled(run)) && (await run('gh', ['auth', 'status'])).code === 0;

  /** @param {string} branch @returns {Promise<Verdict>} */
  const verdict = async (branch) => {
    const merged = (await text(['branch', '--merged', ref, '--format=%(refname:short)'])).split('\n');
    if (merged.includes(branch)) return { done: true, how: 'merged', reason: `merged into ${base}` };
    if (gh) {
      const r = await run('gh', ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number,mergedAt']);
      if (r.code === 0) {
        try {
          const prs = JSON.parse(r.stdout || '[]');
          if (prs.length > 0) return { done: true, how: 'squash', reason: `pull request #${prs[0].number} was merged (squash/rebase)` };
        } catch { /* fall through to the heuristic */ }
      }
    }
    const cherry = (await text(['cherry', ref, branch])).split('\n').filter(Boolean);
    if (cherry.length > 0 && cherry.every((l) => l.startsWith('-'))) {
      return { done: true, how: 'squash', reason: `every commit is already in ${base} by patch-id (heuristic, no merged pull request found${gh ? '' : ': gh is not available'})` };
    }
    return { done: false, reason: gh ? `no merged pull request for it and ${cherry.filter((l) => l.startsWith('+')).length} commit(s) are not in ${base}` : `${cherry.filter((l) => l.startsWith('+')).length} commit(s) are not in ${base} (gh not available, checked by ancestry and patch-id only)` };
  };

  // Worktrees: which branch is checked out where. The first entry is the main checkout and is never removed.
  const wtText = await text(['worktree', 'list', '--porcelain']);
  const worktrees = wtText.split('\n\n').filter(Boolean).map((block) => ({
    path: block.match(/^worktree (.+)$/m)?.[1] ?? '',
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? '',
  }));
  const extra = worktrees.slice(1);

  /** @param {string} branch @returns {Promise<boolean>} true when its worktree (if any) is gone or absent */
  const clearWorktree = async (branch) => {
    const wt = extra.find((w) => w.branch === branch);
    if (!wt) return true;
    const cmd = `git worktree remove ${wt.path}`;
    if (!(apply && withWorktrees)) {
      out(`  branch ${branch} is checked out in a worktree; remove it with: ${cmd}`);
      return false;
    }
    if ((await text(['-C', wt.path, 'status', '--porcelain']))) {
      out(`  kept worktree ${wt.path}: it has uncommitted changes`);
      summary.kept.push(`worktree ${wt.path} (uncommitted changes)`);
      return false;
    }
    const rm = await git(['worktree', 'remove', wt.path]);
    if (rm.code !== 0) {
      out(`  kept worktree ${wt.path}: ${rm.stderr.trim()}`);
      return false;
    }
    summary.deleted.push(`worktree ${wt.path}`);
    return true;
  };

  let exit = 0;
  if (target) {
    const v = await verdict(target);
    if (!v.done) {
      io.stderr(`not merged yet: ${target} (${v.reason}). Kept.\n`);
      summary.kept.push(`${target} (not merged yet)`);
      exit = 1;
    } else if (!apply) {
      out(`would delete local branch ${target} (${v.reason})${withRemote ? ' and, if it still exists, origin/' + target : ''}`);
    } else if (await clearWorktree(target)) {
      const del = await git(['branch', v.how === 'merged' ? '-d' : '-D', target]);
      if (del.code === 0) {
        out(`deleted local branch ${target} (${v.reason})`);
        summary.deleted.push(target);
      } else {
        out(`kept ${target}: ${del.stderr.trim()}`);
        summary.kept.push(target);
      }
      if (withRemote) {
        if ((await git(['ls-remote', '--exit-code', '--heads', 'origin', target])).code === 0) {
          const push = await git(['push', 'origin', '--delete', target]);
          if (push.code === 0) {
            out(`deleted origin/${target}`);
            summary.deleted.push(`origin/${target}`);
          } else out(`could not delete origin/${target}: ${push.stderr.trim()}`);
        } else out(`origin/${target} no longer exists (already deleted)`);
      }
    } else summary.kept.push(`${target} (worktree)`);
    if (v.done && v.how === 'squash') out('  note: a squash or rebase merge leaves the original commits unmerged by ancestry, so git itself calls the branch unmerged; the check above is why -D is safe here.');
  } else out('No feature branch to finish (you are on the default branch; pass --branch <name>).');

  // Other finished branches and worktrees: listed with the exact command, never removed here (worktrees only with --worktrees).
  const locals = (await text(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').filter((b) => b && b !== base && b !== target);
  for (const b of locals) {
    const v = await verdict(b);
    if (!v.done) continue;
    out(`finished (${v.reason}): ${b}`);
    out(`  delete with: git branch ${v.how === 'merged' ? '-d' : '-D'} ${b}`);
    if (extra.some((w) => w.branch === b)) await clearWorktree(b);
  }

  out(`\nSummary: updated: ${summary.updated.join(', ') || 'nothing'}; deleted: ${summary.deleted.join(', ') || 'nothing'}; kept: ${summary.kept.join(', ') || 'nothing'}`);
  return exit;
}
