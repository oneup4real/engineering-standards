import { describe, it, expect } from 'vitest';
import { preCommit, prePush } from '../lib/hooks.js';
import { makeIo } from './helpers.js';

function fakeDeps({ staged = ['src/a.ts'], installed = ['gitleaks'], failing = [] } = {}) {
  const calls = [];
  return {
    calls,
    stagedPaths: async () => staged,
    which: async (bin) => installed.includes(bin),
    exec: async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      const failed = failing.some((f) => [cmd, ...args].join(' ').includes(f));
      return { code: failed ? 1 : 0, stdout: '', stderr: '' };
    },
  };
}

describe('preCommit', () => {
  it('pre-commit fails with hint when gitleaks missing', async () => {
    const io = makeIo();
    expect(await preCommit(io, fakeDeps({ installed: [] }))).toBe(1);
    expect(io.err).toContain('brew install gitleaks');
  });

  it('pre-commit stops at forbidden file before running gitleaks', async () => {
    const io = makeIo();
    const deps = fakeDeps({ staged: ['secret.docx'] });
    expect(await preCommit(io, deps)).toBe(1);
    expect(deps.calls).toEqual([]);
    expect(io.err).toContain('secret.docx');
  });

  it('pre-commit runs gitleaks then lint-staged when clean', async () => {
    const deps = fakeDeps();
    expect(await preCommit(makeIo(), deps)).toBe(0);
    expect(deps.calls).toEqual(['gitleaks protect --staged --redact --no-banner', 'npx --no-install lint-staged']);
  });

  it('pre-commit stops when gitleaks finds a secret', async () => {
    const deps = fakeDeps({ failing: ['gitleaks'] });
    const io = makeIo();
    expect(await preCommit(io, deps)).toBe(1);
    expect(deps.calls).toHaveLength(1);
    expect(io.err).toContain('secret');
  });
});

describe('prePush', () => {
  it('pre-push returns non-zero when tsc fails', async () => {
    const deps = fakeDeps({ failing: ['tsc'] });
    expect(await prePush(makeIo(), deps)).toBe(1);
    expect(deps.calls).toEqual(['npx --no-install tsc --noEmit']);
  });

  it('pre-push runs typecheck then tests', async () => {
    const deps = fakeDeps();
    expect(await prePush(makeIo(), deps)).toBe(0);
    expect(deps.calls).toEqual(['npx --no-install tsc --noEmit', 'npm test --silent']);
  });
});

function sastDeps(over = {}) {
  const base = fakeDeps({ installed: ['gitleaks', ...(over.semgrep === false ? [] : ['semgrep'])], failing: over.failing ?? [], staged: over.staged ?? ['src/a.ts', 'README.md', 'src/b.tsx'] });
  return Object.assign(base, { rulesFile: async () => (over.rules === null ? null : '/pkg/semgrep/standards.yml'), readConfig: async () => over.config ?? {} });
}

describe('preCommit SAST on staged files', () => {
  it('runs semgrep with our rules file on staged code files only, report-only by default', async () => {
    const deps = sastDeps({ failing: ['semgrep'] });
    const io = makeIo();
    expect(await preCommit(io, deps)).toBe(0);
    expect(deps.calls.at(-1)).toBe('semgrep scan --config /pkg/semgrep/standards.yml --metrics=off --quiet src/a.ts src/b.tsx');
    expect(deps.calls.at(-1)).not.toContain('--error');
    expect(io.err).toMatch(/report-only/);
  });

  it('hooks.sastBlocking adds --error and fails the commit on findings', async () => {
    const deps = sastDeps({ failing: ['semgrep'], config: { hooks: { sastBlocking: true } } });
    const io = makeIo();
    expect(await preCommit(io, deps)).toBe(1);
    expect(deps.calls.at(-1)).toContain('--error');
    expect(io.err).toMatch(/SAST/);
  });

  it('prints one install hint and continues when semgrep is missing', async () => {
    const deps = sastDeps({ semgrep: false });
    const io = makeIo();
    expect(await preCommit(io, deps)).toBe(0);
    expect(deps.calls.some((c) => c.startsWith('semgrep'))).toBe(false);
    expect(io.err.trim().split('\n').filter((l) => l.includes('brew install semgrep'))).toHaveLength(1);
  });

  it('skips silently when no code files are staged or no rules file exists', async () => {
    const docs = sastDeps({ staged: ['README.md'] });
    const io = makeIo();
    expect(await preCommit(io, docs)).toBe(0);
    expect(io.err).not.toMatch(/semgrep/);
    const noRules = sastDeps({ rules: null, semgrep: false });
    const io2 = makeIo();
    expect(await preCommit(io2, noRules)).toBe(0);
    expect(io2.err).not.toMatch(/semgrep/);
  });

  it('runs SAST after gitleaks and lint-staged, and not at all when lint fails', async () => {
    const ok = sastDeps();
    await preCommit(makeIo(), ok);
    expect(ok.calls.map((c) => c.split(' ')[0])).toEqual(['gitleaks', 'npx', 'semgrep']);
    const bad = sastDeps({ failing: ['lint-staged'] });
    expect(await preCommit(makeIo(), bad)).toBe(1);
    expect(bad.calls.some((c) => c.startsWith('semgrep'))).toBe(false);
  });
});

function auditDeps({ changed = true, online = true, failing = [], config = {} } = {}) {
  return Object.assign(fakeDeps({ failing }), { lockfileChanged: async () => changed, online: async () => online, readConfig: async () => config });
}

describe('prePush SCA', () => {
  it('runs npm audit once after tsc and tests when package-lock.json changed, default level high', async () => {
    const deps = auditDeps();
    expect(await prePush(makeIo(), deps)).toBe(0);
    expect(deps.calls).toEqual(['npx --no-install tsc --noEmit', 'npm test --silent', 'npm audit --omit=dev --audit-level=high']);
  });

  it('uses hooks.auditLevel', async () => {
    const deps = auditDeps({ config: { hooks: { auditLevel: 'critical' } } });
    await prePush(makeIo(), deps);
    expect(deps.calls.at(-1)).toBe('npm audit --omit=dev --audit-level=critical');
  });

  it('does not audit when the lockfile is unchanged', async () => {
    const deps = auditDeps({ changed: false });
    expect(await prePush(makeIo(), deps)).toBe(0);
    expect(deps.calls.some((c) => c.startsWith('npm audit'))).toBe(false);
  });

  it('offline: one note, no audit, never fails', async () => {
    const deps = auditDeps({ online: false });
    const io = makeIo();
    expect(await prePush(io, deps)).toBe(0);
    expect(deps.calls.some((c) => c.startsWith('npm audit'))).toBe(false);
    expect(io.err.trim().split('\n').filter((l) => /offline/i.test(l))).toHaveLength(1);
  });

  it('findings are report-only by default and block with hooks.auditBlocking', async () => {
    const soft = auditDeps({ failing: ['npm audit'] });
    const io = makeIo();
    expect(await prePush(io, soft)).toBe(0);
    expect(io.err).toMatch(/report-only/);
    const hard = auditDeps({ failing: ['npm audit'], config: { hooks: { auditBlocking: true } } });
    expect(await prePush(makeIo(), hard)).toBe(1);
  });

  it('skips the audit when tests already failed', async () => {
    const deps = auditDeps({ failing: ['npm test'] });
    expect(await prePush(makeIo(), deps)).toBe(1);
    expect(deps.calls.some((c) => c.startsWith('npm audit'))).toBe(false);
  });
});

describe('prePush default-branch guard', () => {
  const Z = '0'.repeat(40);
  const A = 'a'.repeat(40);
  const line = (remoteRef, localSha = A, localRef = 'refs/heads/work') => `${localRef} ${localSha} ${remoteRef} ${Z}\n`;
  const guarded = (stdin, { config = {}, head = 'refs/remotes/origin/main' } = {}) => ({
    ...fakeDeps(),
    readStdin: async () => stdin,
    readConfig: async () => config,
    defaultBranch: async () => head,
  });
  const MSG = 'Direct pushes to main are blocked by the standards. Push a feature branch and open a pull request: npx oneup-standards pr. Humans can override once: ONEUP_ALLOW_DEFAULT_PUSH=1 git push ...';

  it('lets a feature branch through to the normal checks', async () => {
    const deps = guarded(line('refs/heads/feat/x'));
    expect(await prePush(makeIo(), deps)).toBe(0);
    expect(deps.calls).toEqual(['npx --no-install tsc --noEmit', 'npm test --silent']);
  });

  it('refuses a push to the default branch before running any check', async () => {
    const deps = guarded(line('refs/heads/main'));
    const io = makeIo();
    expect(await prePush(io, deps)).toBe(1);
    expect(deps.calls).toEqual([]);
    expect(io.err).toContain(MSG);
  });

  it('refuses master as well', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/heads/master')))).toBe(1);
  });

  it('allows the push with the human override env', async () => {
    const deps = guarded(line('refs/heads/main'));
    expect(await prePush(makeIo(process.cwd(), { ONEUP_ALLOW_DEFAULT_PUSH: '1' }), deps)).toBe(0);
  });

  it('only the exact value 1 overrides', async () => {
    expect(await prePush(makeIo(process.cwd(), { ONEUP_ALLOW_DEFAULT_PUSH: 'true' }), guarded(line('refs/heads/main')))).toBe(1);
  });

  it('allows deleting a remote feature branch, without running the checks', async () => {
    const deps = guarded(`(delete) ${Z} refs/heads/feat/x ${A}\n`);
    expect(await prePush(makeIo(), deps)).toBe(0);
    expect(deps.calls).toEqual([]);
  });

  it('refuses deleting the default branch', async () => {
    expect(await prePush(makeIo(), guarded(`(delete) ${Z} refs/heads/main ${A}\n`))).toBe(1);
  });

  it('allows tag pushes', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/tags/v1.0.0', A, 'refs/tags/v1.0.0')))).toBe(0);
  });

  it('refuses when one of several refs is the default branch', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/heads/feat/x') + line('refs/heads/main')))).toBe(1);
  });

  it('does not guard when hooks.protectDefaultBranch is false', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/heads/main'), { config: { hooks: { protectDefaultBranch: false } } }))).toBe(0);
  });

  it('protects a default branch other than main (origin/HEAD), and main stays protected', async () => {
    const head = 'refs/remotes/origin/develop';
    const io = makeIo();
    expect(await prePush(io, guarded(line('refs/heads/develop'), { head }))).toBe(1);
    expect(io.err).toContain('Direct pushes to develop are blocked');
    expect(await prePush(makeIo(), guarded(line('refs/heads/main'), { head }))).toBe(1);
  });

  it('hooks.defaultBranch overrides origin/HEAD', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/heads/trunk'), { config: { hooks: { defaultBranch: 'trunk' } } }))).toBe(1);
  });

  it('falls back to main when origin/HEAD cannot be resolved', async () => {
    expect(await prePush(makeIo(), guarded(line('refs/heads/main'), { head: null }))).toBe(1);
  });
});
