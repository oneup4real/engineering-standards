import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runFinish } from '../lib/finish.js';
import { makeRun } from '../lib/process.js';
import { makeIo, tempDir } from './helpers.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitFile = async (cwd, name, text = name) => {
  await fs.writeFile(path.join(cwd, name), text);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', `add ${name}`);
};

/** Bare origin + clone on main with one commit. Identity is set per repo, nothing global is touched. */
async function setup() {
  const origin = await tempDir('oneup-origin-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const dir = await tempDir('oneup-clone-');
  git(dir, 'clone', '-q', origin, '.');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await commitFile(dir, 'base.txt');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return { origin, dir };
}
/** Real git, scripted gh. */
const runner = (cwd, gh = { code: 127, stdout: '', stderr: '' }) => {
  const real = makeRun(cwd);
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh') return typeof gh === 'function' ? gh(args) : gh;
    return real(cmd, args, opts);
  };
  run.calls = calls;
  return run;
};
const GH_MERGED = (args) => (args[0] === 'pr' ? { code: 0, stdout: '[{"number":9,"mergedAt":"2026-10-24T10:00:00Z"}]', stderr: '' } : { code: 0, stdout: '', stderr: '' });
const branches = (dir) => git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');

describe('finish', () => {
  it('dry run changes nothing and says what it would do', async () => {
    const { dir } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/a');
    await commitFile(dir, 'a.txt');
    git(dir, 'switch', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge a', 'feat/a');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'switch', '-q', 'feat/a');
    const io = makeIo(dir);
    expect(await runFinish([], io, { run: runner(dir) })).toBe(0);
    expect(io.out).toMatch(/Dry run/);
    expect(io.out).toMatch(/would delete.*feat\/a/);
    expect(branches(dir)).toContain('feat/a');
    expect(git(dir, 'branch', '--show-current')).toBe('feat/a');
  });

  it('merged by ancestry: switches to main, pulls, deletes the local branch, remote only with --remote', async () => {
    const { dir, origin } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/a');
    await commitFile(dir, 'a.txt');
    git(dir, 'push', '-q', 'origin', 'feat/a');
    // merge happens "on GitHub": directly in origin via a second clone
    const other = await tempDir('oneup-other-');
    git(other, 'clone', '-q', origin, '.');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'config', 'user.name', 'T');
    git(other, 'config', 'commit.gpgsign', 'false');
    git(other, 'merge', '-q', '--no-ff', '-m', 'merge a', 'origin/feat/a');
    git(other, 'push', '-q', 'origin', 'main');
    const io = makeIo(dir);
    expect(await runFinish(['--apply', '--remote'], io, { run: runner(dir) })).toBe(0);
    expect(git(dir, 'branch', '--show-current')).toBe('main');
    expect(branches(dir)).not.toContain('feat/a');
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('a.txt');
    expect(git(origin, 'branch', '--list', 'feat/a')).toBe('');
    expect(io.out).toMatch(/deleted local branch feat\/a/);
  });

  it('squash-merged: proven by gh, deleted with -D', async () => {
    const { dir } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/s');
    await commitFile(dir, 's1.txt');
    await commitFile(dir, 's2.txt');
    const run = runner(dir, GH_MERGED);
    expect(await runFinish(['--apply'], makeIo(dir), { run })).toBe(0);
    expect(branches(dir)).not.toContain('feat/s');
    expect(run.calls).toContain('git branch -D feat/s');
    expect(run.calls.some((c) => c.startsWith('gh pr list --head feat/s --state merged --json number,mergedAt'))).toBe(true);
  });

  it('squash-merged without gh: patch-id heuristic (git cherry), and says so', async () => {
    const { dir, origin } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/p');
    await commitFile(dir, 'p.txt');
    // same patch lands on main as a different commit (rebase/cherry-pick style merge)
    const sha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'switch', '-q', 'main');
    await commitFile(dir, 'other.txt'); // different parent, so the cherry-pick gets a different hash
    git(dir, 'cherry-pick', sha);
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'switch', '-q', 'feat/p');
    const io = makeIo(dir);
    expect(await runFinish(['--apply'], io, { run: runner(dir) })).toBe(0);
    expect(branches(dir)).not.toContain('feat/p');
    expect(io.out).toMatch(/heuristic/i);
    void origin;
  });

  it('never deletes an unmerged branch', async () => {
    const { dir } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/open');
    await commitFile(dir, 'o.txt');
    const io = makeIo(dir);
    expect(await runFinish(['--apply'], io, { run: runner(dir) })).toBe(1);
    expect(io.out + io.err).toMatch(/not merged yet: feat\/open/);
    expect(branches(dir)).toContain('feat/open');
  });

  it('refuses with a dirty working tree and changes nothing', async () => {
    const { dir } = await setup();
    git(dir, 'switch', '-q', '-c', 'feat/d');
    await fs.writeFile(path.join(dir, 'base.txt'), 'changed');
    const run = runner(dir);
    const io = makeIo(dir);
    expect(await runFinish(['--apply'], io, { run })).toBe(2);
    expect(io.err).toMatch(/uncommitted/i);
    expect(io.err).toContain('base.txt');
    expect(run.calls.some((c) => /fetch|switch|branch -[dD]/.test(c))).toBe(false);
  });

  it('stops when main cannot fast-forward', async () => {
    const { dir, origin } = await setup();
    await commitFile(dir, 'local.txt'); // local main diverges
    const other = await tempDir('oneup-other-');
    git(other, 'clone', '-q', origin, '.');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'config', 'user.name', 'T');
    git(other, 'config', 'commit.gpgsign', 'false');
    await commitFile(other, 'remote.txt');
    git(other, 'push', '-q', 'origin', 'main');
    git(dir, 'switch', '-q', '-c', 'feat/x');
    const io = makeIo(dir);
    expect(await runFinish(['--apply'], io, { run: runner(dir) })).toBe(1);
    expect(io.err).toMatch(/fast-forward/);
    expect(branches(dir)).toContain('feat/x');
  });

  it('lists other finished branches and worktrees; removes worktrees only with --worktrees', async () => {
    const { dir } = await setup();
    git(dir, 'branch', 'feat/old'); // no unique commits: merged by ancestry
    const wt = path.join(await fs.realpath(await tempDir('oneup-wt-')), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'feat/wt', wt);
    const io = makeIo(dir);
    expect(await runFinish(['--apply'], io, { run: runner(dir) })).toBe(0);
    expect(io.out).toContain('git branch -d feat/old');
    expect(io.out).toContain(`git worktree remove ${wt}`);
    expect(branches(dir)).toEqual(expect.arrayContaining(['feat/old', 'feat/wt']));
    expect(await fs.access(wt).then(() => true, () => false)).toBe(true);

    const io2 = makeIo(dir);
    expect(await runFinish(['--apply', '--worktrees'], io2, { run: runner(dir) })).toBe(0);
    expect(await fs.access(wt).then(() => true, () => false)).toBe(false);
  });

  it('keeps a finished worktree that has uncommitted changes', async () => {
    const { dir } = await setup();
    const wt = path.join(await fs.realpath(await tempDir('oneup-wt-')), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'feat/dirty', wt);
    await fs.writeFile(path.join(wt, 'new.txt'), 'wip');
    const io = makeIo(dir);
    await runFinish(['--apply', '--worktrees'], io, { run: runner(dir) });
    expect(await fs.access(wt).then(() => true, () => false)).toBe(true);
    expect(io.out).toMatch(/uncommitted/);
  });
});
