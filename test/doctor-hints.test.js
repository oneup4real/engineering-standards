import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initProject, RECOMMENDED_ANSWERS } from '../lib/init.js';
import { inspectProject } from '../lib/doctor.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { tempDir, makeIo } from './helpers.js';

async function project(pkg = {}) {
  const dir = await tempDir();
  const home = await tempDir('oneup-home-');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '16' }, ...pkg }, null, 2));
  await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, hooks: false }, homeDir: home });
  return { dir, home };
}
const write = async (dir, rel, text) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
};
const hintIds = async (dir, home) => (await inspectProject({ targetDir: dir, homeDir: home })).hints.map((h) => h.id);

describe('doctor hints are hints, never failures', () => {
  it('do not change items or the exit code', async () => {
    const { dir, home } = await project();
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    expect(report.items.every((i) => i.status === 'ok')).toBe(true);
    expect(report.hints.length).toBeGreaterThan(0);
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor'], io)).toBe(0);
    expect(io.out).toMatch(/Hints \(optional/);
    expect(io.out).toMatch(/mutation/);
  });

  it('--warn-only prints hints as notices, not warnings', async () => {
    const { dir, home } = await project();
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor', '--warn-only'], io)).toBe(0);
    expect(io.out).toMatch(/::notice::\[standards doctor\] hint mutation/);
    expect(io.out).not.toMatch(/::warning.*hint/);
  });
});

describe('security scans (one pipeline: security.yml)', () => {
  const CI = (inputs) => `name: ci\non: [push]\njobs:\n  security:\n    uses: oneup4real/engineering-standards/.github/workflows/security.yml@v1\n${inputs ? `    with:\n${inputs}\n` : ''}`;

  it('a project using security.yml with semgrep true gets no SAST or SCA hint', async () => {
    const { dir, home } = await project();
    const ids = await hintIds(dir, home);
    expect(ids).not.toContain('sast');
    expect(ids).not.toContain('sca');
  });

  it('security.yml with codeql on (the default) counts as SAST and SCA', async () => {
    const { dir, home } = await project();
    await write(dir, '.github/workflows/ci.yml', CI(''));
    const ids = await hintIds(dir, home);
    expect(ids).not.toContain('sast');
    expect(ids).not.toContain('sca');
  });

  it('security.yml with codeql false and semgrep off hints SAST only; audit still counts', async () => {
    const { dir, home } = await project();
    await write(dir, '.github/workflows/ci.yml', CI('      codeql: false'));
    const ids = await hintIds(dir, home);
    expect(ids).toContain('sast');
    expect(ids).not.toContain('sca');
  });

  it('without security.yml: hints for both; own CodeQL, Semgrep rules or npm audit silence them', async () => {
    const { dir, home } = await project();
    await write(dir, '.github/workflows/ci.yml', 'name: ci\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
    expect(await hintIds(dir, home)).toEqual(expect.arrayContaining(['sast', 'sca']));
    await write(dir, '.semgrep/standards.yml', 'rules: []\n');
    await write(dir, '.github/workflows/audit.yml', 'name: a\non: [push]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm audit --omit=dev\n');
    const ids = await hintIds(dir, home);
    expect(ids).not.toContain('sast');
    expect(ids).not.toContain('sca');
    await fs.rm(path.join(dir, '.semgrep'), { recursive: true });
    await write(dir, '.github/workflows/codeql.yml', 'name: c\non: [push]\njobs:\n  c:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: github/codeql-action/analyze@abc\n');
    expect(await hintIds(dir, home)).not.toContain('sast');
  });

  it('hints when the project hook repeats pre-push work', async () => {
    const { dir, home } = await project();
    await write(dir, '.husky/pre-commit', 'npx --no-install oneup-standards hook pre-commit\nnpx tsc --noEmit\nnpm run test:unit\nnpm test\n');
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    const hint = report.hints.find((h) => h.id === 'hook-duplicate-checks');
    expect(hint.message).toContain('npx tsc --noEmit');
    expect(hint.message).toContain('npm run test:unit');
    expect(hint.message).not.toContain('oneup-standards hook pre-commit');
  });

  it('no duplicate-hook hint for the plain managed pre-commit', async () => {
    const { dir, home } = await project();
    await write(dir, '.husky/pre-commit', 'npx --no-install oneup-standards hook pre-commit\n');
    expect(await hintIds(dir, home)).not.toContain('hook-duplicate-checks');
  });

  it('stryker in package.json counts as mutation config', async () => {
    const { dir, home } = await project({ devDependencies: { '@stryker-mutator/core': '^9.0.0' } });
    expect(await hintIds(dir, home)).not.toContain('mutation');
  });
});

describe('T3 specs', () => {
  it('no hint without specs; hints when specs lack a tier line and abuse cases', async () => {
    const { dir, home } = await project();
    expect(await hintIds(dir, home)).not.toContain('spec-risk-tier');
    await write(dir, 'docs/superpowers/specs/2026-10-01-pay.md', '# Pay\n\nText only.\n');
    const ids = await hintIds(dir, home);
    expect(ids).toEqual(expect.arrayContaining(['spec-risk-tier', 'spec-abuse-cases']));
  });

  it('silent when a spec states its tier and has an Abuse cases heading', async () => {
    const { dir, home } = await project();
    await write(dir, 'docs/superpowers/specs/pay.md', '# Pay\n\nRisk tier: T3\n\n## Abuse cases\n- replay\n');
    const ids = await hintIds(dir, home);
    expect(ids).not.toContain('spec-risk-tier');
    expect(ids).not.toContain('spec-abuse-cases');
  });

  it('an abuse-cases file counts', async () => {
    const { dir, home } = await project();
    await write(dir, 'docs/specs/a.md', '# A\nTier: T2\n');
    await write(dir, 'docs/specs/abuse-cases.md', '# x\n');
    expect(await hintIds(dir, home)).not.toContain('spec-abuse-cases');
  });
});

describe('test:unit equals the CI test project', () => {
  const ci = (cmd) => `name: x\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${cmd}\n`;
  it('hints when CI runs another vitest project than test:unit', async () => {
    const { dir, home } = await project({ scripts: { 'test:unit': 'vitest run --project unit' } });
    await write(dir, '.github/workflows/ci.yml', ci('npx vitest run --project all'));
    expect(await hintIds(dir, home)).toContain('test-project-mismatch');
  });
  it('hints when test:unit names a project and CI runs vitest without it', async () => {
    const { dir, home } = await project({ scripts: { 'test:unit': 'vitest run --project unit' } });
    await write(dir, '.github/workflows/ci.yml', ci('npx vitest run'));
    expect(await hintIds(dir, home)).toContain('test-project-mismatch');
  });
  it('silent when they agree, or when there is no project flag anywhere', async () => {
    const a = await project({ scripts: { 'test:unit': 'vitest run --project unit' } });
    await write(a.dir, '.github/workflows/ci.yml', ci('npx vitest run --project unit --coverage'));
    expect(await hintIds(a.dir, a.home)).not.toContain('test-project-mismatch');
    const b = await project({ scripts: { 'test:unit': 'vitest run' } });
    expect(await hintIds(b.dir, b.home)).not.toContain('test-project-mismatch');
  });
});

describe('duplicated standards text', () => {
  it('hints when the FULL standard is in the project AGENTS.md and in the global file', async () => {
    const { dir, home } = await project();
    expect(await hintIds(dir, home)).not.toContain('duplicate-standards');
    const { upsertManagedBlock } = await import('../lib/managed-block.js');
    const rules = await fs.readFile(path.join(import.meta.dirname, '..', 'agents', 'AGENTS.global.md'), 'utf8');
    await write(home, '.agents/AGENTS.md', upsertManagedBlock(null, rules));
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    const hint = report.hints.find((h) => h.id === 'duplicate-standards');
    expect(hint?.message).toMatch(/twice/);
    expect(hint?.message).toMatch(/tokens/);
    expect(hint?.message).toMatch(/sync-agents --global/);
  });

  it('no hint when the global block is the short bootstrap form', async () => {
    const { dir, home } = await project();
    const { syncAgents } = await import('../lib/sync-agents.js');
    await syncAgents({ targetDir: dir, global: true, homeDir: home });
    expect(await hintIds(dir, home)).not.toContain('duplicate-standards');
  });
});

describe('factory-review skill', () => {
  it('hints when an AI harness home exists but the skill is not installed; silent after sync-skills', async () => {
    const { dir, home } = await project();
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    expect(await hintIds(dir, home)).toContain('factory-review-skill');
    const { syncSkills } = await import('../lib/sync-skills.js');
    await syncSkills({ homeDir: home, scope: 'global' });
    expect(await hintIds(dir, home)).not.toContain('factory-review-skill');
  });

  it('no hint on a machine without Claude Code or Antigravity', async () => {
    const { dir, home } = await project();
    expect(await hintIds(dir, home)).not.toContain('factory-review-skill');
  });
});

describe('branch-protection hint', () => {
  const run = (script) => async (cmd, args) => {
    const key = Object.keys(script).find((k) => `${cmd} ${args.join(' ')}`.startsWith(k));
    return { code: 0, stdout: '', stderr: '', ...(key ? script[key] : { code: 1 }) };
  };
  const script = {
    'git remote get-url origin': { stdout: 'https://github.com/acme/shop.git' },
    'gh --version': {},
    'gh auth status': {},
    'gh api repos/acme/shop --jq': { stdout: 'main' },
    'gh api repos/acme/shop/branches/main/protection': { code: 1, stderr: 'HTTP 404 Branch not protected' },
  };

  it('is a hint, never a failure, and appears for an unprotected default branch', async () => {
    const { dir, home } = await project();
    const report = await inspectProject({ targetDir: dir, homeDir: home, run: run(script), ci: false });
    expect(report.hints.map((h) => h.id)).toContain('branch-protection');
    expect(report.items.every((i) => i.status === 'ok')).toBe(true);
  });

  it('is skipped in CI, without a runner and without a remote', async () => {
    const { dir, home } = await project();
    for (const opts of [{ run: run(script), ci: true }, {}, { run: run({}), ci: false }]) {
      const report = await inspectProject({ targetDir: dir, homeDir: home, ...opts });
      expect(report.hints.map((h) => h.id)).not.toContain('branch-protection');
    }
  });

  it('points to the manual instruction when gh is not available', async () => {
    const { dir, home } = await project();
    const report = await inspectProject({ targetDir: dir, homeDir: home, run: run({ ...script, 'gh --version': { code: 127 } }), ci: false });
    expect(report.hints.find((h) => h.id === 'branch-protection').message).toMatch(/Settings/);
  });
});

describe('agent merge deny rule', () => {
  const settings = (deny) => JSON.stringify({ permissions: { deny } });

  it('hints when .claude/settings.json exists without a gh pr merge deny rule', async () => {
    const { dir, home } = await project();
    expect(await hintIds(dir, home)).not.toContain('agent-merge-deny');
    await write(dir, '.claude/settings.json', settings(['Read(.env)']));
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    const hint = report.hints.find((h) => h.id === 'agent-merge-deny');
    expect(hint.message).toContain('Bash(gh pr merge:*)');
    expect(report.items.every((i) => i.status === 'ok')).toBe(true);
  });

  it('silent when the rule exists in settings.json or settings.local.json', async () => {
    const a = await project();
    await write(a.dir, '.claude/settings.json', settings(['Bash(gh pr merge:*)']));
    expect(await hintIds(a.dir, a.home)).not.toContain('agent-merge-deny');
    const b = await project();
    await write(b.dir, '.claude/settings.json', '{}');
    await write(b.dir, '.claude/settings.local.json', settings(['Bash(gh pr merge:*)']));
    expect(await hintIds(b.dir, b.home)).not.toContain('agent-merge-deny');
  });

  it('ignores unreadable settings files', async () => {
    const { dir, home } = await project();
    await write(dir, '.claude/settings.json', '{not json');
    expect(await hintIds(dir, home)).toContain('agent-merge-deny');
  });
});
