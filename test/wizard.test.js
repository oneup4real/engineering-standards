import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runWizard } from '../lib/wizard.js';
import { makeIo, tempDir } from './helpers.js';

async function repo() {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '16' } }));
  await fs.mkdir(path.join(dir, '.git'));
  await fs.writeFile(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/me/demo.git\n');
  return dir;
}

function deps({ answers = {}, installed = ['gitleaks', 'gh'], failing = [] } = {}) {
  const prompts = [];
  const calls = [];
  return {
    prompts,
    calls,
    prompt: async (q) => {
      prompts.push(q);
      return q.id in answers ? answers[q.id] : q.default;
    },
    exec: async (cmd, args) => {
      const line = [cmd, ...args].join(' ');
      calls.push(line);
      return { code: failing.some((f) => line.startsWith(f)) ? 1 : 0 };
    },
    which: async (bin) => installed.includes(bin),
  };
}

describe('runWizard', () => {
  it('wizard --yes uses recommended defaults and never calls gh without consent', async () => {
    const dir = await repo();
    const d = deps();
    expect(await runWizard(makeIo(dir), { ...d, yes: true })).toBe(0);
    expect(d.calls.some((c) => c.startsWith('gh '))).toBe(false);
    expect(d.prompts).toEqual([]);
  });

  it('wizard explains each step before asking', async () => {
    const dir = await repo();
    const d = deps();
    await runWizard(makeIo(dir), d);
    expect(d.prompts.length).toBeGreaterThanOrEqual(6);
    for (const q of d.prompts) expect(q.explain.trim().length, q.id).toBeGreaterThan(20);
  });

  it('applies github protection only after an explicit yes', async () => {
    const dir = await repo();
    const d = deps({ answers: { protection: true } });
    await runWizard(makeIo(dir), d);
    expect(d.calls.some((c) => c.startsWith('gh api') && c.includes('repos/me/demo/rulesets'))).toBe(true);
  });

  it('offers to install superpowers when claude is installed and superpowers is missing', async () => {
    const dir = await repo();
    const home = await tempDir();
    const d = { ...deps({ installed: ['gh', 'gitleaks', 'claude'], answers: { installSuperpowers: true } }), homeDir: home };
    await runWizard(makeIo(dir), d);
    expect(d.prompts.some((p) => p.id === 'installSuperpowers')).toBe(true);
    expect(d.calls).toContain('claude plugin install superpowers@superpowers-marketplace');
  });

  it('offers to install superpowers into Antigravity when claude is missing but ~/.gemini exists', async () => {
    const dir = await repo();
    const home = await tempDir();
    await fs.mkdir(path.join(home, '.gemini'), { recursive: true });
    const d = { ...deps({ installed: ['gh', 'gitleaks'], answers: { installSuperpowers: true } }), homeDir: home };
    await runWizard(makeIo(dir), d);
    expect(d.prompts.some((p) => p.id === 'installSuperpowers')).toBe(true);
    expect(d.calls.some((c) => c.includes('git clone') && c.includes('superpowers'))).toBe(true);
  });

  it('offers to install gitleaks when missing and installs only on yes', async () => {
    const dir = await repo();
    const d = deps({ installed: ['gh', 'brew'], answers: { installGitleaks: true } });
    await runWizard(makeIo(dir), d);
    expect(d.calls).toContain('brew install gitleaks');
  });

  it('asks whether to migrate an existing non-vitest test script and migrates on migrate answer', async () => {
    const dir = await repo();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
    const d = deps({ answers: { vitest: 'migrate' } });
    await runWizard(makeIo(dir), d);
    const vitestPrompt = d.prompts.find((p) => p.id === 'vitest');
    expect(vitestPrompt).toBeDefined();
    expect(vitestPrompt.default).toBe('migrate');
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:legacy']).toBe('node --test');
  });

  it('preserves existing test script when user answers keep', async () => {
    const dir = await repo();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
    const d = deps({ answers: { vitest: 'keep' } });
    await runWizard(makeIo(dir), d);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('node --test');
  });

  it('prints a summary with next steps', async () => {
    const dir = await repo();
    const io = makeIo(dir);
    await runWizard(io, { ...deps(), yes: true });
    expect(io.out).toContain('Summary');
    expect(io.out).toContain('git commit');
  });
});

describe('runWizard failures', () => {
  it('reports a failed npm install and repeats it in next steps', async () => {
    const dir = await repo();
    const io = makeIo(dir);
    const d = deps({ failing: ['npm install'] });
    await runWizard(io, { ...d, yes: true });
    expect(io.out).toContain('npm install FAILED');
    expect(io.out).toMatch(/Next steps:[\s\S]*npm install/);
    expect(d.calls.some((c) => c.includes('depcruise'))).toBe(false);
  });

  it('names the missing piece when gh is absent but a remote exists', async () => {
    const dir = await repo();
    const io = makeIo(dir);
    await runWizard(io, { ...deps({ installed: ['gitleaks'] }), yes: true });
    expect(io.out).toContain('GitHub CLI (gh) is not installed');
  });
});

describe('runWizard bundle markers', () => {
  it('asks for confidential markers and enables the bundle check', async () => {
    const dir = await repo();
    const d = deps({ answers: { markers: 'SECRET-ID-, INTERNAL-' } });
    await runWizard(makeIo(dir), d);
    const config = JSON.parse(await fs.readFile(path.join(dir, '.standardsrc.json'), 'utf8'));
    expect(config.bundleForbiddenMarkers).toEqual(['SECRET-ID-', 'INTERNAL-']);
    expect(await fs.readFile(path.join(dir, '.github/workflows/ci.yml'), 'utf8')).toContain('bundle-check: true');
  });
});
