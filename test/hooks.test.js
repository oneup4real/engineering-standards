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
