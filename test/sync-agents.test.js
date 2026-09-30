import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncAgents } from '../lib/sync-agents.js';
import { BEGIN_MARKER } from '../lib/managed-block.js';
import { tempDir } from './helpers.js';

const read = (p) => fs.readFile(p, 'utf8');
const byFile = (results, suffix) => results.find((r) => r.file.endsWith(suffix));

describe('syncAgents project mode', () => {
  it('writes AGENTS.md block, CLAUDE.md and GEMINI.md', async () => {
    const dir = await tempDir();
    const results = await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    expect(await read(path.join(dir, 'AGENTS.md'))).toContain(BEGIN_MARKER);
    expect(await read(path.join(dir, 'CLAUDE.md'))).toContain('@AGENTS.md');
    expect(await read(path.join(dir, 'GEMINI.md'))).toContain('@AGENTS.md');
    expect(results.every((r) => r.action === 'created')).toBe(true);
  });

  it('adds the current-state section to a new AGENTS.md outside the managed block', async () => {
    const dir = await tempDir();
    await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    const content = await read(path.join(dir, 'AGENTS.md'));
    expect(content.indexOf('## Current state vs. target')).toBeLessThan(content.indexOf(BEGIN_MARKER));
  });

  it('preserves an existing hand-written AGENTS.md byte for byte', async () => {
    const dir = await tempDir();
    const original = '# Existing rules\n\nDo not touch.\n';
    await fs.writeFile(path.join(dir, 'AGENTS.md'), original);
    const results = await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    expect((await read(path.join(dir, 'AGENTS.md'))).startsWith(original)).toBe(true);
    expect(byFile(results, 'AGENTS.md').action).toBe('updated');
  });

  it('leaves a CLAUDE.md that already imports AGENTS.md unchanged', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    const results = await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    expect(await read(path.join(dir, 'CLAUDE.md'))).toBe('@AGENTS.md\n');
    expect(byFile(results, 'CLAUDE.md').action).toBe('unchanged');
  });

  it('adds the pointer to a CLAUDE.md with other content, keeping that content', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Claude notes\n');
    await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    const content = await read(path.join(dir, 'CLAUDE.md'));
    expect(content.startsWith('# Claude notes\n')).toBe(true);
    expect(content).toContain('@AGENTS.md');
  });

  it('second run reports unchanged', async () => {
    const dir = await tempDir();
    await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    const results = await syncAgents({ targetDir: dir, global: false, homeDir: dir });
    expect(results.map((r) => r.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
  });
});

describe('syncAgents global mode', () => {
  it('writes canonical file, tool pointers and a full Codex copy', async () => {
    const home = await tempDir();
    const canonical = path.join(home, '.agents', 'AGENTS.md');
    await syncAgents({ targetDir: home, global: true, homeDir: home });
    expect(await read(canonical)).toContain(BEGIN_MARKER);
    expect(await read(path.join(home, '.claude', 'CLAUDE.md'))).toContain(`@${canonical}`);
    expect(await read(path.join(home, '.gemini', 'GEMINI.md'))).toContain(`@${canonical}`);
    const codex = await read(path.join(home, '.codex', 'AGENTS.md'));
    expect(codex).toContain('NEVER');
  });

  it('only writes inside homeDir', async () => {
    const home = await tempDir();
    const results = await syncAgents({ targetDir: '/nonexistent', global: true, homeDir: home });
    for (const r of results) expect(r.file.startsWith(home)).toBe(true);
  });
});
