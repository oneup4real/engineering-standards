import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function makeIo(cwd = process.cwd(), env = {}) {
  const out = [];
  const err = [];
  return {
    cwd,
    env,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    get out() { return out.join(''); },
    get err() { return err.join(''); },
  };
}

export async function tempDir(prefix = 'oneup-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
