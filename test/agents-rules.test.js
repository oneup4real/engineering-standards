import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_SKILLS, discoverBundledSkills } from '../lib/sync-skills.js';

const AGENTS = path.join(import.meta.dirname, '..', 'agents');

describe('agent rules stay in sync with the skill list', () => {
  it('every bundled skill is required', async () => {
    const bundled = await discoverBundledSkills();
    expect(Object.keys(bundled)).toContain('ui-consistency');
    for (const name of Object.keys(bundled)) expect(REQUIRED_SKILLS).toContain(name);
  });

  it('AGENTS.global.md lists every required skill in the pre-flight', async () => {
    const text = await fs.readFile(path.join(AGENTS, 'AGENTS.global.md'), 'utf8');
    const preflight = text.split('## 1.')[0];
    for (const name of REQUIRED_SKILLS) expect(preflight).toContain(`- \`${name}\``);
  });

  it('AGENTS.global.md carries the UI rules and the reviewer check', async () => {
    const text = await fs.readFile(path.join(AGENTS, 'AGENTS.global.md'), 'utf8');
    expect(text).toMatch(/\*\*Reuse UI before building UI\.\*\*/);
    expect(text).toMatch(/\*\*Refactor UI only behind a visual baseline\.\*\*/);
    expect(text).toMatch(/Checks UI changes against the project's UI catalog/);
    expect(text).toMatch(/~\/\.claude\/skills/);
  });

  it('AGENTS.project.md has a UI catalog section for projects to fill in', async () => {
    const text = await fs.readFile(path.join(AGENTS, 'AGENTS.project.md'), 'utf8');
    expect(text).toMatch(/## UI catalog/);
  });
});
