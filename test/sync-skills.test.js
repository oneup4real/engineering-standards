import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverInstalledSkills, discoverSkills, syncSkills, checkMissingSkills, REQUIRED_SKILLS, BUNDLED_SKILLS_DIR, discoverBundledSkills, inspectClaudeSkills } from '../lib/sync-skills.js';

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

    const discovered = await discoverSkills({ cacheDir, bundledDir: path.join(tmp, 'no-bundled') });
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
    const results = await syncSkills({ homeDir, cacheDir, bundledDir: path.join(tmp, 'no-bundled') });

    const targetSkill = path.join(homeDir, '.gemini', 'config', 'skills', 'superdesign');
    expect(await fs.readFile(path.join(targetSkill, 'SKILL.md'), 'utf8')).toBe('# Superdesign');
    expect(await fs.readFile(path.join(targetSkill, 'references', 'REF.md'), 'utf8')).toBe('# Ref content');
    
    expect(results).toHaveLength(1);
    expect(results[0].skill).toBe('superdesign');
    expect(results[0].action).toBe('created');

    // Second run should be unchanged
    const secondResults = await syncSkills({ homeDir, cacheDir, bundledDir: path.join(tmp, 'no-bundled') });
    expect(secondResults[0].action).toBe('unchanged');
  });

  it('handles empty or missing cache gracefully', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const homeDir = path.join(tmp, 'home');
    const cacheDir = path.join(tmp, 'nonexistent');

    const results = await syncSkills({ homeDir, cacheDir, bundledDir: path.join(tmp, 'no-bundled') });
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


  it('discovers skills across custom marketplace directories like superpowers-marketplace', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const spDir = path.join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers', '6.4.2', 'skills');
    await fs.mkdir(path.join(spDir, 'writing-plans'), { recursive: true });
    await fs.writeFile(path.join(spDir, 'writing-plans', 'SKILL.md'), '# Writing Plans');

    const discovered = await discoverSkills({ homeDir: home });
    expect(discovered['writing-plans']).toBe(path.join(spDir, 'writing-plans'));
  });

  it('discovers skills in standalone ~/.superpowers directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const spDir = path.join(home, '.superpowers', 'skills', 'test-driven-development');
    await fs.mkdir(spDir, { recursive: true });
    await fs.writeFile(path.join(spDir, 'SKILL.md'), '# TDD');

    const discovered = await discoverSkills({ homeDir: home });
    expect(discovered['test-driven-development']).toBe(spDir);
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



describe('bundled skills', () => {
  it('ships ui-consistency inside the package', async () => {
    const found = await discoverBundledSkills();
    expect(found['ui-consistency']).toBe(path.join(BUNDLED_SKILLS_DIR, 'ui-consistency'));
    const text = await fs.readFile(path.join(found['ui-consistency'], 'SKILL.md'), 'utf8');
    expect(text).toMatch(/^---\nname: ui-consistency\ndescription: .+\n---/);
    const ref = await fs.readFile(path.join(found['ui-consistency'], 'references', 'react-primitives.md'), 'utf8');
    expect(ref).toMatch(/extendTailwindMerge/);
    expect(text).toMatch(/references\/react-primitives\.md/);
  });

  it('bundled skills override a plugin skill with the same name', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const cacheDir = path.join(tmp, 'cache');
    const pluginCopy = path.join(cacheDir, 'evil', '1.0.0', 'skills', 'ui-consistency');
    await fs.mkdir(pluginCopy, { recursive: true });
    await fs.writeFile(path.join(pluginCopy, 'SKILL.md'), '# not ours');
    const bundledDir = path.join(tmp, 'bundled');
    await fs.mkdir(path.join(bundledDir, 'ui-consistency'), { recursive: true });
    await fs.writeFile(path.join(bundledDir, 'ui-consistency', 'SKILL.md'), '# ours');

    const discovered = await discoverSkills({ cacheDir, bundledDir });
    expect(discovered['ui-consistency']).toBe(path.join(bundledDir, 'ui-consistency'));
  });

  it('a missing bundled dir yields no bundled skills', async () => {
    expect(await discoverBundledSkills({ bundledDir: '/nonexistent/skills' })).toEqual({});
  });
});

describe('Claude Code installation of bundled skills', () => {
  async function setup() {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const bundledDir = path.join(tmp, 'bundled');
    await fs.mkdir(path.join(bundledDir, 'ui-consistency'), { recursive: true });
    await fs.writeFile(path.join(bundledDir, 'ui-consistency', 'SKILL.md'), '# v1');
    const cacheDir = path.join(tmp, 'cache');
    await fs.mkdir(path.join(cacheDir, 'p', '1', 'skills', 'brainstorming'), { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'p', '1', 'skills', 'brainstorming', 'SKILL.md'), '# b');
    return { tmp, bundledDir, cacheDir, homeDir: path.join(tmp, 'home') };
  }

  it('global sync copies bundled skills to ~/.claude/skills, plugin skills only to Antigravity', async () => {
    const { bundledDir, cacheDir, homeDir } = await setup();
    const results = await syncSkills({ homeDir, cacheDir, bundledDir });
    expect(await fs.readFile(path.join(homeDir, '.claude', 'skills', 'ui-consistency', 'SKILL.md'), 'utf8')).toBe('# v1');
    expect(await fs.access(path.join(homeDir, '.claude', 'skills', 'brainstorming')).then(() => true, () => false)).toBe(false);
    expect(await fs.readFile(path.join(homeDir, '.gemini', 'config', 'skills', 'ui-consistency', 'SKILL.md'), 'utf8')).toBe('# v1');
    expect(results.filter((r) => r.harness === 'claude').map((r) => r.skill)).toEqual(['ui-consistency']);
    expect(results.filter((r) => r.harness === 'antigravity').map((r) => r.skill).sort()).toEqual(['brainstorming', 'ui-consistency']);
  });

  it('project sync writes bundled skills to <project>/.claude/skills', async () => {
    const { tmp, bundledDir, cacheDir, homeDir } = await setup();
    const targetDir = path.join(tmp, 'proj');
    await syncSkills({ homeDir, cacheDir, bundledDir, targetDir, scope: 'project' });
    expect(await fs.readFile(path.join(targetDir, '.claude', 'skills', 'ui-consistency', 'SKILL.md'), 'utf8')).toBe('# v1');
  });

  it('reports missing, then ok, then outdated after a package upgrade, and re-sync fixes it', async () => {
    const { bundledDir, cacheDir, homeDir } = await setup();
    expect(await inspectClaudeSkills({ homeDir, bundledDir })).toEqual({ missing: ['ui-consistency'], outdated: [] });
    await syncSkills({ homeDir, cacheDir, bundledDir });
    expect(await inspectClaudeSkills({ homeDir, bundledDir })).toEqual({ missing: [], outdated: [] });

    await fs.writeFile(path.join(bundledDir, 'ui-consistency', 'SKILL.md'), '# v2');
    expect(await inspectClaudeSkills({ homeDir, bundledDir })).toEqual({ missing: [], outdated: ['ui-consistency'] });

    const again = await syncSkills({ homeDir, cacheDir, bundledDir });
    expect(again.find((r) => r.harness === 'claude')?.action).toBe('updated');
    expect(await fs.readFile(path.join(homeDir, '.claude', 'skills', 'ui-consistency', 'SKILL.md'), 'utf8')).toBe('# v2');
  });

  it('doctor shows a claude-skills item when ~/.claude exists', async () => {
    const { inspectProject } = await import('../lib/doctor.js');
    const { initProject, RECOMMENDED_ANSWERS } = await import('../lib/init.js');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const targetDir = path.join(tmp, 'proj');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'demo' }));
    await initProject({ targetDir, answers: { ...RECOMMENDED_ANSWERS, hooks: false }, homeDir: home });
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });

    const report = await inspectProject({ targetDir, homeDir: home });
    const item = report.items.find((i) => i.id === 'claude-skills');
    expect(item?.status).toBe('missing');
    expect(item?.message).toMatch(/ui-consistency/);
  });

  it('discoverInstalledSkills ignores bundled skills, so "nothing installed" stays detectable', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    expect(await discoverInstalledSkills({ homeDir: home })).toEqual({});
    expect(Object.keys(await discoverSkills({ homeDir: home }))).toContain('ui-consistency');
  });

  it('builtin fallbacks are only written when installed skills were found', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const results = await syncSkills({ homeDir: home, includeFallbacks: true });
    expect(results.map((r) => r.skill)).not.toContain('frontend-design');
  });
});

describe('factory-review skill distribution', () => {
  it('is required, bundled, and installed for Claude Code and Antigravity', async () => {
    expect(REQUIRED_SKILLS).toContain('factory-review');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const results = await syncSkills({ homeDir: home, scope: 'global' });
    const installed = results.filter((r) => r.skill === 'factory-review').map((r) => r.harness).sort();
    expect(installed).toEqual(['antigravity', 'claude']);
    for (const dir of ['.claude/skills', '.gemini/config/skills']) {
      await fs.access(path.join(home, dir, 'factory-review', 'SKILL.md'));
      await fs.access(path.join(home, dir, 'factory-review', 'references', 'security-review.md'));
    }
  });

  it('doctor names factory-review when it is missing for Claude Code', async () => {
    const { inspectProject } = await import('../lib/doctor.js');
    const { initProject, RECOMMENDED_ANSWERS } = await import('../lib/init.js');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'standards-skills-'));
    const home = path.join(tmp, 'home');
    const targetDir = path.join(tmp, 'proj');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'demo' }));
    await initProject({ targetDir, answers: { ...RECOMMENDED_ANSWERS, hooks: false }, homeDir: home });
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    const item = (await inspectProject({ targetDir, homeDir: home })).items.find((i) => i.id === 'claude-skills');
    expect(item?.status).toBe('missing');
    expect(item?.message).toMatch(/factory-review/);
  });
});
