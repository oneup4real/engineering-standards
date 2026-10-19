import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_SKILLS } from '../lib/sync-skills.js';

const README = path.join(import.meta.dirname, '..', 'README.md');

describe('README documents the UI consistency approach', () => {
  it('has the UI guardrails subsection linked from the TOC', async () => {
    const text = await fs.readFile(README, 'utf8');
    expect(text).toMatch(/^### UI Consistency Guardrails$/m);
    expect(text).toMatch(/\(#ui-consistency-guardrails\)/);
  });

  it('lists every required skill', async () => {
    const text = await fs.readFile(README, 'utf8');
    for (const name of REQUIRED_SKILLS) expect(text).toContain(`\`${name}\``);
  });

  it('documents the style ratchet config, suite option and Claude Code install path', async () => {
    const text = await fs.readFile(README, 'utf8');
    for (const s of ['uiStyleRatchet', 'styleRatchet: true', 'checkStyleRatchet', '~/.claude/skills', 'tailwind-merge', 'Radix UI', 'toHaveScreenshot']) expect(text).toContain(s);
  });
});
