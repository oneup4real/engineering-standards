import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectReadiness, formatReadiness, humanTodo } from '../lib/readiness.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { initProject, RECOMMENDED_ANSWERS } from '../lib/init.js';
import { makeIo, tempDir } from './helpers.js';

const runner = (script = {}) => {
  const calls = [];
  const run = async (cmd, args) => {
    const line = `${cmd} ${args.join(' ')}`;
    calls.push(line);
    const key = Object.keys(script).find((k) => line.startsWith(k));
    return { code: 0, stdout: '', stderr: '', ...(key ? script[key] : { code: 1 }) };
  };
  run.calls = calls;
  return run;
};
const FULL = {
  'git remote get-url origin': { stdout: 'git@github.com:acme/shop.git' },
  'gh --version': {},
  'gh auth status': {},
  'gh api repos/acme/shop --jq': { stdout: 'main' },
  'gh api repos/acme/shop/branches/main/protection': { stdout: JSON.stringify({ required_pull_request_reviews: {}, required_status_checks: { contexts: ['ci'] } }) },
};
const byId = (items, id) => items.find((i) => i.id === id);

async function project() {
  const dir = await tempDir();
  const home = await tempDir('oneup-home-');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '16' } }));
  await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, hooks: true }, homeDir: home });
  return { dir, home };
}

describe('collectReadiness', () => {
  it('reports everything missing with the exact command, and no GitHub items as ok', async () => {
    const dir = await tempDir();
    const home = await tempDir('oneup-home-');
    const items = await collectReadiness({ targetDir: dir, homeDir: home, run: runner(), ci: false });
    expect(byId(items, 'git-remote').state).toBe('missing');
    expect(byId(items, 'git-remote').command).toMatch(/git remote add origin/);
    expect(byId(items, 'gh-installed').command).toBe('brew install gh');
    expect(byId(items, 'gh-auth').command).toBe('gh auth login');
    expect(byId(items, 'branch-protection').state).toBe('n/a');
    expect(byId(items, 'skills').command).toBe('npx oneup-standards sync-skills');
    expect(byId(items, 'hooks').state).toBe('missing');
    expect(byId(items, 'ci').state).toBe('missing');
    expect(byId(items, 'pr-template').state).toBe('missing');
  });

  it('marks a fully set up project ok, optional tools stay optional', async () => {
    const { dir, home } = await project();
    const items = await collectReadiness({ targetDir: dir, homeDir: home, run: runner(FULL), ci: false });
    for (const id of ['git-remote', 'gh-installed', 'gh-auth', 'branch-protection', 'hooks', 'ci', 'pr-template']) expect(byId(items, id).state).toBe('ok');
    expect(items.find((i) => i.id === 'sast' || i.id === 'sca')).toBeUndefined();
    expect(byId(items, 'mutation').state).toBe('missing');
    expect(byId(items, 'mutation').optional).toBe(true);
    expect(byId(items, 'mutation').detail).toMatch(/report only/i);
  });

  it('branch protection missing when GitHub says 404', async () => {
    const { dir, home } = await project();
    const script = { ...FULL, 'gh api repos/acme/shop/branches/main/protection': { code: 1, stderr: 'HTTP 404 Branch not protected' } };
    const items = await collectReadiness({ targetDir: dir, homeDir: home, run: runner(script), ci: false });
    expect(byId(items, 'branch-protection').state).toBe('missing');
    expect(byId(items, 'branch-protection').command).toBe('npx oneup-standards protect-branch');
  });

  it('in CI no external tool is called and GitHub items are n/a', async () => {
    const { dir, home } = await project();
    const run = runner(FULL);
    const items = await collectReadiness({ targetDir: dir, homeDir: home, run, ci: true });
    expect(run.calls).toEqual([]);
    for (const id of ['gh-installed', 'gh-auth', 'branch-protection']) expect(byId(items, id).state).toBe('n/a');
  });
});

describe('formatReadiness and humanTodo', () => {
  it('prints state, label and the command for missing items', async () => {
    const dir = await tempDir();
    const home = await tempDir('oneup-home-');
    const items = await collectReadiness({ targetDir: dir, homeDir: home, run: runner(), ci: false });
    const text = formatReadiness(items);
    expect(text).toMatch(/missing\s+GitHub CLI/);
    expect(text).toContain('brew install gh');
    expect(text).toMatch(/n\/a\s+Branch protection/);
  });

  it('lists what only the human can do, depending on the state', async () => {
    const dir = await tempDir();
    const home = await tempDir('oneup-home-');
    const noGh = humanTodo(await collectReadiness({ targetDir: dir, homeDir: home, run: runner(), ci: false })).join('\n');
    expect(noGh).toMatch(/Settings .* Branches/);
    const { dir: d2, home: h2 } = await project();
    await fs.mkdir(path.join(d2, '.github/workflows'), { recursive: true });
    await fs.writeFile(path.join(d2, '.github/workflows/standards-dast.yml'), 'name: dast\n');
    const todo = humanTodo(await collectReadiness({ targetDir: d2, homeDir: h2, run: runner(FULL), ci: false })).join('\n');
    expect(todo).toMatch(/DAST_TARGET_URL/);
    expect(todo).toMatch(/STANDARDS_DAST_BLOCKING/);
    expect(todo).not.toMatch(/Settings .* Branches/);
  });
});

describe('doctor prints the checklist', () => {
  it('shows the readiness section without changing the exit code', async () => {
    const { dir, home } = await project();
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor'], io)).toBe(0);
    expect(io.out).toMatch(/Readiness checklist/);
    expect(io.out).toMatch(/What you still have to do yourself/);
  });
});
