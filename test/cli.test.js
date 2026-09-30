import { describe, it, expect } from 'vitest';
import { runCli } from '../lib/cli.js';
import { makeIo } from './helpers.js';

describe('runCli', () => {
  it('unknown command prints usage and returns 2', async () => {
    const io = makeIo();
    expect(await runCli(['nope'], io)).toBe(2);
    expect(io.err).toContain('Usage: oneup-standards <command>');
  });

  it('no args prints usage and returns 2', async () => {
    const io = makeIo();
    expect(await runCli([], io)).toBe(2);
    expect(io.err).toContain('Usage: oneup-standards <command>');
  });
});
