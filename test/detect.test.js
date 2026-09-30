import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from '../lib/detect.js';
import { tempDir } from './helpers.js';

describe('detectProject', () => {
  it('detect finds nextjs, firebase, remote and existing files', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '16', firebase: '12' } }));
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/oneup4real/demo.git\n');
    await fs.writeFile(path.join(dir, 'eslint.config.mjs'), 'export default []');
    await fs.writeFile(path.join(dir, 'vitest.config.mts'), 'export default {}');
    const info = await detectProject(dir);
    expect(info).toMatchObject({ isEmpty: false, name: 'demo', framework: 'nextjs', usesFirebase: true, githubRemote: 'oneup4real/demo' });
    expect(info.existing).toEqual(expect.arrayContaining(['eslint.config.mjs', 'vitest.config.ts']));
  });

  it('parses ssh remotes', async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:me/app.git\n');
    expect((await detectProject(dir)).githubRemote).toBe('me/app');
  });

  it('detect reports empty dir', async () => {
    const info = await detectProject(await tempDir());
    expect(info).toMatchObject({ isEmpty: true, name: null, framework: 'unknown', usesFirebase: false, githubRemote: null, existing: [] });
  });
});
