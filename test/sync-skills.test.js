import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSkills, syncSkills, checkMissingSkills, REQUIRED_SKILLS } from '../lib/sync-skills.js';

describe('sync-skills', () => {
  it('discovers skills across plugins in cache', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const cacheDir = path.join(tmp, '.claude', 'plugins', 'cache', 'claude-plugins-official');
    
    // Mock plugin 1: superpowers with multiple skills
    const spDir = path.join(cacheDir, 'superpowers', '6.4.1', 'skills');
    await fs.mkdir(path.join(spDir, 'brainstorming'), { recursive: true });
    await fs.writeFile(path.join(spDir, 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\n---\n# Brainstorming');
    await fs.mkdir(path.join(spDir, 'test-driven-development'), { recursive: true });
    await fs.writeFile(path.join(spDir, 'test-driven-development', 'SKILL.md'), '---\nname: test-driven-development\n---\n# TDD');

    // Mock plugin 2: frontend-design
    const fdDir = path.join(cacheDir, 'frontend-design', '1.0.0', 'skills', 'frontend-design');
    await fs.mkdir(fdDir, { recursive: true });
    await fs.writeFile(path.join(fdDir, 'SKILL.md'), '---\nname: frontend-design\n---\n# Design');

    const discovered = await discoverSkills({ cacheDir });
    expect(Object.keys(discovered).sort()).toEqual(['brainstorming', 'frontend-design', 'test-driven-development']);
    expect(discovered.brainstorming).toBe(path.join(spDir, 'brainstorming'));
    expect(discovered['frontend-design']).toBe(fdDir);
  });

  it('syncs discovered skills into Antigravity global skills directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const cacheDir = path.join(tmp, '.claude', 'plugins', 'cache', 'claude-plugins-official');
    const skillSource = path.join(cacheDir, 'superdesign', '0.6.0', 'skills', 'superdesign');
    await fs.mkdir(skillSource, { recursive: true });
    await fs.writeFile(path.join(skillSource, 'SKILL.md'), '# Superdesign');
    await fs.mkdir(path.join(skillSource, 'references'), { recursive: true });
    await fs.writeFile(path.join(skillSource, 'references', 'REF.md'), '# Ref content');

    const homeDir = path.join(tmp, 'home');
    const results = await syncSkills({ homeDir, cacheDir });

    const targetSkill = path.join(homeDir, '.gemini', 'config', 'skills', 'superdesign');
    expect(await fs.readFile(path.join(targetSkill, 'SKILL.md'), 'utf8')).toBe('# Superdesign');
    expect(await fs.readFile(path.join(targetSkill, 'references', 'REF.md'), 'utf8')).toBe('# Ref content');
    
    expect(results).toHaveLength(1);
    expect(results[0].skill).toBe('superdesign');
    expect(results[0].action).toBe('created');

    // Second run should be unchanged
    const secondResults = await syncSkills({ homeDir, cacheDir });
    expect(secondResults[0].action).toBe('unchanged');
  });

  it('handles empty or missing cache gracefully', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const homeDir = path.join(tmp, 'home');
    const cacheDir = path.join(tmp, 'nonexistent');

    const results = await syncSkills({ homeDir, cacheDir });
    expect(results).toEqual([]);
  });

  it('checks for missing skills', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const homeDir = path.join(tmp, 'home');
    const skillsDir = path.join(homeDir, '.gemini', 'config', 'skills');

    // Initially all required skills should be missing
    const missingInitial = await checkMissingSkills({ homeDir });
    expect(missingInitial).toEqual(REQUIRED_SKILLS);

    // Provide one skill
    await fs.mkdir(path.join(skillsDir, 'brainstorming'), { recursive: true });
    await fs.writeFile(path.join(skillsDir, 'brainstorming', 'SKILL.md'), '# Brainstorming');

    const missingAfter = await checkMissingSkills({ homeDir });
    expect(missingAfter).not.toContain('brainstorming');
    expect(missingAfter).toContain('test-driven-development');
  });

  it('check-skills CLI command exits 1 when skills are missing, 0 when present', async () => {
    const { runCli } = await import('../lib/cli.js');
    const { makeIo } = await import('./helpers.js');
    await import('../lib/commands.js');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const io1 = makeIo(tmp, { HOME: home });

    const exit1 = await runCli(['check-skills'], io1);
    expect(exit1).toBe(1);
    expect(io1.err).toMatch(/Missing required AI skills in Antigravity/);
    expect(io1.err).toMatch(/oneup-standards sync-skills/);

    // Install all required skills
    for (const skill of REQUIRED_SKILLS) {
      const sDir = path.join(home, '.gemini', 'config', 'skills', skill);
      await fs.mkdir(sDir, { recursive: true });
      await fs.writeFile(path.join(sDir, 'SKILL.md'), `# ${skill}`);
    }

    const io2 = makeIo(tmp, { HOME: home });
    const exit2 = await runCli(['check-skills'], io2);
    expect(exit2).toBe(0);
    expect(io2.out).toMatch(/All required AI skills are installed/);
  });

  it('sync-skills CLI command syncs skills and doctor reports ok', async () => {
    const { runCli } = await import('../lib/cli.js');
    const { makeIo } = await import('./helpers.js');
    const { inspectProject } = await import('../lib/doctor.js');
    const { initProject, RECOMMENDED_ANSWERS } = await import('../lib/init.js');
    await import('../lib/commands.js');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const targetDir = path.join(tmp, 'proj');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'demo' }));

    // Init project
    await initProject({ targetDir, answers: { ...RECOMMENDED_ANSWERS, hooks: false }, homeDir: home });

    // Mark as having Antigravity installed by creating ~/.gemini
    await fs.mkdir(path.join(home, '.gemini'), { recursive: true });

    // Doctor should report skills missing
    const report1 = await inspectProject({ targetDir, homeDir: home });
    const skillsItem1 = report1.items.find((i) => i.id === 'skills');
    expect(skillsItem1).toBeDefined();
    expect(skillsItem1.status).toBe('missing');

    // Create a mock plugin cache with the required skills
    const cacheDir = path.join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official');
    for (const skill of REQUIRED_SKILLS) {
      const sDir = path.join(cacheDir, 'plugin', '1.0.0', 'skills', skill);
      await fs.mkdir(sDir, { recursive: true });
      await fs.writeFile(path.join(sDir, 'SKILL.md'), `# ${skill}`);
    }

    // Run sync-skills CLI
    const ioSync = makeIo(targetDir, { HOME: home });
    expect(await runCli(['sync-skills'], ioSync)).toBe(0);
    expect(ioSync.out).toMatch(/Synchronized \d+ skills/);

    // Doctor should now report skills ok
    const report2 = await inspectProject({ targetDir, homeDir: home });
    const skillsItem2 = report2.items.find((i) => i.id === 'skills');
    expect(skillsItem2.status).toBe('ok');
  });
});


