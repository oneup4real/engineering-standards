import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('test isolation', () => {
  it('tests never run against the real home directory', () => {
    const home = fs.realpathSync(os.homedir());
    expect(home.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)).toBe(true);
  });
});
