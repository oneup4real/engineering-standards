import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanForMarkers, checkBundle, BundleDirError } from '../lib/bundle-check.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { makeIo, tempDir } from './helpers.js';

describe('scanForMarkers', () => {
  it('finds marker in file', () => {
    const files = [{ path: 'a.js', content: 'var x="SECRET-ID-01"' }];
    expect(scanForMarkers(files, ['SECRET-ID-'])).toEqual([{ path: 'a.js', marker: 'SECRET-ID-' }]);
  });

  it('returns empty when clean', () => {
    expect(scanForMarkers([{ path: 'a.js', content: 'ok' }], ['SECRET'])).toEqual([]);
  });
});

describe('checkBundle', () => {
  it('throws when directory missing', async () => {
    await expect(checkBundle({ dir: '/definitely/not/here', markers: ['x'] })).rejects.toBeInstanceOf(BundleDirError);
  });

  it('throws when directory has no js files', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'a.css'), 'body{}');
    await expect(checkBundle({ dir, markers: ['x'] })).rejects.toBeInstanceOf(BundleDirError);
  });

  it('scans nested js files', async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, 'chunks'));
    await fs.writeFile(path.join(dir, 'chunks', 'c.js'), 'leak INTERNAL-REF-01');
    const found = await checkBundle({ dir, markers: ['INTERNAL-REF-'] });
    expect(found).toHaveLength(1);
    expect(found[0].path).toContain('c.js');
  });
});

describe('check-bundle command', () => {
  it('CLI exits 2 without markers configured', async () => {
    const dir = await tempDir();
    const io = makeIo(dir);
    expect(await runCli(['check-bundle'], io)).toBe(2);
    expect(io.err).toContain('bundleForbiddenMarkers');
  });

  it('CLI reads bundleDir from .standardsrc.json and exits 1 on a hit', async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, 'out'));
    await fs.writeFile(path.join(dir, 'out', 'x.js'), 'SEED-123');
    await fs.writeFile(path.join(dir, '.standardsrc.json'), JSON.stringify({ bundleDir: 'out', bundleForbiddenMarkers: ['SEED-'] }));
    const io = makeIo(dir);
    expect(await runCli(['check-bundle'], io)).toBe(1);
    expect(io.err).toContain('SEED-');
  });
});
