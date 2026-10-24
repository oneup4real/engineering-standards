import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPr, buildBody } from '../lib/pr.js';
import { makeIo, tempDir } from './helpers.js';

function mockRun(script = {}) {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    const line = `${cmd} ${args.join(' ')}`;
    calls.push({ line, input: opts.input });
    const key = Object.keys(script).find((k) => line.startsWith(k));
    return { code: 0, stdout: '', stderr: '', ...(key ? script[key] : { code: 1 }) };
  };
  run.calls = calls;
  run.lines = () => calls.map((c) => c.line);
  return run;
}
const BASE = {
  'git branch --show-current': { stdout: 'feat/x\n' },
  'git symbolic-ref --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' },
  'git remote get-url origin': { stdout: 'git@github.com:acme/shop.git\n' },
  'git log --format=%s origin/main..HEAD': { stdout: 'feat: add x\nfix: y\n' },
  'git diff --name-only --diff-filter=ACMR origin/main...HEAD': { stdout: 'src/app/actions/pay.ts\nREADME.md\n' },
};
const GH = { 'gh --version': {}, 'gh auth status': {}, 'gh pr create': { stdout: 'https://github.com/acme/shop/pull/7\n' } };

async function dir(withTemplate = true) {
  const d = await tempDir();
  if (withTemplate) {
    await fs.mkdir(path.join(d, '.github'), { recursive: true });
    await fs.writeFile(path.join(d, '.github/pull_request_template.md'), '## What & why\n\nTEMPLATE\n');
  }
  return d;
}

describe('buildBody', () => {
  it('puts tier, reviewers, approval need, commits and the template together', () => {
    const body = buildBody({ template: '## T\n', tier: { tier: 'T3', reviewers: ['security', 'logic'], humanApproval: true }, commits: ['feat: a'] });
    expect(body).toContain('Risk tier (computed): T3');
    expect(body).toContain('security, logic');
    expect(body).toMatch(/Human approval required: yes/);
    expect(body).toContain('- feat: a');
    expect(body).toContain('## T');
  });
});

describe('runPr', () => {
  it('refuses on the default branch and does nothing else', async () => {
    const run = mockRun({ ...BASE, 'git branch --show-current': { stdout: 'main\n' }, ...GH });
    const io = makeIo(await dir());
    expect(await runPr([], io, { run })).toBe(2);
    expect(io.err).toMatch(/default branch/);
    expect(run.lines().some((l) => l.startsWith('gh pr create') || l.startsWith('git push'))).toBe(false);
  });

  it('with gh: creates the PR from the template + tier + commits and prints the URL', async () => {
    const run = mockRun({ ...BASE, ...GH });
    const io = makeIo(await dir());
    expect(await runPr(['--title', 'My title', '--draft'], io, { run }));
    const create = run.calls.find((c) => c.line.startsWith('gh pr create'));
    expect(create.line).toBe('gh pr create --base main --head feat/x --title My title --body-file - --draft');
    expect(create.input).toContain('Risk tier (computed): T3');
    expect(create.input).toContain('TEMPLATE');
    expect(create.input).toContain('- feat: add x');
    expect(io.out).toContain('https://github.com/acme/shop/pull/7');
  });

  it('never pushes unless --push, never merges', async () => {
    const run = mockRun({ ...BASE, ...GH });
    await runPr([], makeIo(await dir()), { run });
    expect(run.lines().some((l) => l.startsWith('git push'))).toBe(false);
    const run2 = mockRun({ ...BASE, ...GH, 'git push -u origin feat/x': {} });
    await runPr(['--push'], makeIo(await dir()), { run: run2 });
    expect(run2.lines()).toContain('git push -u origin feat/x');
    for (const r of [run, run2]) expect(r.lines().some((l) => /merge|--auto/.test(l))).toBe(false);
  });

  it('without gh: prints the compare URL and the body to paste', async () => {
    const run = mockRun({ ...BASE, 'gh --version': { code: 127 } });
    const io = makeIo(await dir());
    expect(await runPr([], io, { run })).toBe(0);
    expect(io.out).toContain('https://github.com/acme/shop/compare/main...feat%2Fx?expand=1');
    expect(io.out).toContain('Risk tier (computed): T3');
    expect(run.lines().some((l) => l.startsWith('gh pr create'))).toBe(false);
  });

  it('when gh fails it falls back to the compare URL and exits 1', async () => {
    const run = mockRun({ ...BASE, ...GH, 'gh pr create': { code: 1, stderr: 'no commits' } });
    const io = makeIo(await dir());
    expect(await runPr([], io, { run })).toBe(1);
    expect(io.err).toContain('no commits');
    expect(io.out).toContain('/compare/main...feat%2Fx');
  });

  it('--base overrides the default branch; works without a template', async () => {
    const run = mockRun({ ...BASE, 'git log --format=%s origin/dev..HEAD': { stdout: 'feat: z\n' }, 'git diff --name-only --diff-filter=ACMR origin/dev...HEAD': { stdout: 'README.md\n' }, ...GH });
    const io = makeIo(await dir(false));
    await runPr(['--base', 'dev'], io, { run });
    expect(run.lines().find((l) => l.startsWith('gh pr create'))).toContain('--base dev');
    expect(run.calls.find((c) => c.line.startsWith('gh pr create')).input).toContain('Risk tier (computed): T0');
  });
});
