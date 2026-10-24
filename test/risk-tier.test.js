import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPaths, globToRegExp } from '../lib/risk-tier.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { tempDir, makeIo } from './helpers.js';

describe('globToRegExp', () => {
  it('handles **, * and ?', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('**/auth*').test('src/lib/auth-helpers.ts')).toBe(true);
    expect(globToRegExp('**/auth*').test('auth.ts')).toBe(true);
    expect(globToRegExp('firestore.rules').test('firestore.rules')).toBe(true);
    expect(globToRegExp('a?c').test('abc')).toBe(true);
  });
});

describe('classifyPaths (defaults)', () => {
  const tier = (...p) => classifyPaths(p).tier;
  it('empty diff is T0 with no reviewers', () => {
    expect(classifyPaths([])).toMatchObject({ tier: 'T0', reviewers: [], humanApproval: false });
  });
  it('docs, tests and config are T0', () => {
    expect(tier('README.md', 'docs/a.md', 'package.json', 'src/lib/fee.test.ts', 'tests/unit/x.test.ts', 'vitest.config.ts')).toBe('T0');
  });
  it('components and styles are T1 with the ui reviewer', () => {
    const r = classifyPaths(['src/components/Button.tsx', 'src/app/globals.css']);
    expect(r).toMatchObject({ tier: 'T1', reviewers: ['ui'], humanApproval: false });
  });
  it('src/lib is T2 with logic', () => {
    expect(classifyPaths(['src/lib/format.ts'])).toMatchObject({ tier: 'T2', reviewers: ['logic'], humanApproval: false });
  });
  it('actions, server, rules, auth and email templates are T3 and need a human', () => {
    for (const p of ['src/app/actions/a.ts', 'src/server/services/x.ts', 'firestore.rules', 'storage.rules', 'src/lib/auth.ts', 'emails/welcome.tsx', 'src/email-templates/a.html']) {
      const r = classifyPaths([p]);
      expect(r.tier, p).toBe('T3');
      expect(r.humanApproval, p).toBe(true);
    }
  });
  it('money, payment and role keywords in the path make it T3', () => {
    for (const p of ['src/lib/payment-status.ts', 'src/components/RoleSwitcher.tsx', 'src/lib/fee.ts', 'src/lib/money.ts', 'src/lib/invoice/list.ts']) expect(tier(p), p).toBe('T3');
  });
  it('the highest tier of any file wins, and T3 fans out to all five reviewers', () => {
    const r = classifyPaths(['README.md', 'src/components/A.tsx', 'src/app/actions/a.ts']);
    expect(r.tier).toBe('T3');
    expect(r.reviewers).toEqual(['security', 'ui', 'logic', 'arch', 'test-quality']);
    expect(r.files.find((f) => f.path === 'README.md').tier).toBe('T0');
  });
  it('tests of guarded or money code still trigger test-quality', () => {
    const r = classifyPaths(['tests/unit/payment.test.ts']);
    expect(r.tier).toBe('T0');
    expect(r.reviewers).toEqual(['test-quality']);
  });
  it('unknown source paths are classified conservatively as T2', () => {
    expect(tier('lib/whatever.js')).toBe('T2');
  });
  it('config globs replace the defaults of a tier', () => {
    const config = { riskTiers: { T3: ['billing/**'], keywords: [] } };
    expect(classifyPaths(['src/server/a.ts'], config).tier).toBe('T2');
    expect(classifyPaths(['billing/x.ts'], config).tier).toBe('T3');
    expect(classifyPaths(['src/lib/payment.ts'], config).tier).toBe('T2');
  });
});

describe('risk-tier command', () => {
  async function repo() {
    const dir = await tempDir();
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    await fs.writeFile(path.join(dir, 'README.md'), 'x\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-qb', 'feature');
    await fs.mkdir(path.join(dir, 'src/app/actions'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/app/actions/pay.ts'), 'export {}\n');
    await fs.writeFile(path.join(dir, 'README.md'), 'y\n');
    git('add', '.');
    git('commit', '-qm', 'change');
    return dir;
  }

  it('prints tier, reviewers and approval for the diff against --base, exit 0', async () => {
    const dir = await repo();
    const io = makeIo(dir);
    expect(await runCli(['risk-tier', '--base', 'main'], io)).toBe(0);
    expect(io.out).toMatch(/Tier: T3/);
    expect(io.out).toMatch(/Reviewers: security, ui, logic, arch, test-quality/);
    expect(io.out).toMatch(/Human approval required: yes/);
  });

  it('--json is machine readable', async () => {
    const dir = await repo();
    const io = makeIo(dir);
    expect(await runCli(['risk-tier', '--base', 'main', '--json'], io)).toBe(0);
    const data = JSON.parse(io.out);
    expect(data).toMatchObject({ tier: 'T3', humanApproval: true, base: 'main' });
    expect(data.files.map((f) => f.path).sort()).toEqual(['README.md', 'src/app/actions/pay.ts']);
  });

  it('reads riskTiers from .standardsrc.json', async () => {
    const dir = await repo();
    await fs.writeFile(path.join(dir, '.standardsrc.json'), JSON.stringify({ riskTiers: { T3: ['nothing/**'], T2: ['src/app/actions/**'], keywords: [] } }));
    const io = makeIo(dir);
    await runCli(['risk-tier', '--base', 'main', '--json'], io);
    expect(JSON.parse(io.out).tier).toBe('T2');
  });

  it('exit 0 with T0 for an empty diff; exit 2 when the base ref does not exist', async () => {
    const dir = await repo();
    const same = makeIo(dir);
    expect(await runCli(['risk-tier', '--base', 'feature'], same)).toBe(0);
    expect(same.out).toMatch(/Tier: T0/);
    const bad = makeIo(dir);
    expect(await runCli(['risk-tier', '--base', 'nope'], bad)).toBe(2);
    expect(bad.err).toMatch(/nope/);
  });
});
