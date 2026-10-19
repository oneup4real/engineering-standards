// Discovers and synchronizes AI skills across harness caches and Antigravity.
// Ensures skills installed in Claude Code, local git clones, or other plugins
// are available to Antigravity without sandbox policy violations or manual drift.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Skills shipped inside this package. They win over plugin skills with the same name. */
export const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));

export const REQUIRED_SKILLS = [
  'brainstorming',
  'writing-plans',
  'executing-plans',
  'test-driven-development',
  'systematic-debugging',
  'verification-before-completion',
  'requesting-code-review',
  'frontend-design',
  'superdesign',
  'ui-consistency',
];

export const BUILTIN_FALLBACK_SKILLS = {
  'frontend-design': `---
name: frontend-design
description: Create distinctive, polished frontends with high design standards, clean typography, responsive layouts, and curated color palettes.
---

# Frontend Design

## Overview
Guides implementation of distinctive, accessible, and responsive user interfaces with professional visual design, deliberate hierarchy, and harmonious aesthetic systems.

## Guidelines
1. Typography: Choose intentional font hierarchies with clean scale and line heights.
2. Color & Contrast: Curate cohesive HSL palettes, WCAG-compliant contrast ratios, and distinct semantic tokens.
3. Layout & Whitespace: Apply consistent spacing systems (4px/8px grid) and fluid grid layouts.
4. Micro-Interactions: Use subtle transitions, hover states, and feedback animations.
5. Responsiveness: Ensure seamless adaptation across mobile, tablet, and widescreen viewports.
`,
  'superdesign': `---
name: superdesign
description: Design-to-code workflow for components, design tokens, visual themes, and iterative UI variant explorations.
---

# Superdesign

## Overview
Enables an iterative design-first workflow when constructing frontend components, design tokens, and theme systems.

## Workflow
1. Tokens First: Establish design tokens (colors, spacing, typography, radii, elevations) before composing components.
2. Component Isolation: Design components with clear boundaries, reusability, and atomic composition.
3. Exploration & Variants: Iterate on visual alternatives and component variants before committing to final implementation.
4. State Coverage: Cover all states: default, hover, active, focus, disabled, loading, empty, and error states.
`,
};

/**
 * Find every folder below `root` that contains SKILL.md (first match per name wins).
 * @param {string} root
 * @returns {Promise<Record<string, string>>}
 */
async function scanForSkills(root) {
  /** @type {Record<string, string>} */
  const skills = {};
  if (!(await exists(root))) return skills;
  async function scan(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const skillName = path.basename(dir);
      if (!skills[skillName]) skills[skillName] = dir;
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) await scan(path.join(dir, e.name), depth + 1);
    }
  }
  await scan(root);
  return skills;
}

/**
 * Skills shipped inside this package.
 * @param {{ bundledDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>}
 */
export async function discoverBundledSkills({ bundledDir = BUNDLED_SKILLS_DIR } = {}) {
  return scanForSkills(bundledDir);
}

/**
 * Skills installed on this machine (not the package's own).
 * Scans Claude plugin caches, local .superpowers clones, and user agent skills
 * (first root that has a skill wins), unless `cacheDir` names a single root.
 * @param {{ cacheDir?: string, homeDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>} Mapping of skillName -> skillDirPath
 */
export async function discoverInstalledSkills({ cacheDir, homeDir = os.homedir() } = {}) {
  const roots = cacheDir
    ? [cacheDir]
    : [
        // 1. All Claude plugin caches (every marketplace, including superpowers-marketplace)
        path.join(homeDir, '.claude', 'plugins', 'cache'),
        // 2. Standalone superpowers clone
        path.join(homeDir, '.superpowers'),
        // 3. User global agents skills
        path.join(homeDir, '.agents', 'skills'),
      ];
  /** @type {Record<string, string>} */
  const installed = {};
  for (const root of roots) {
    for (const [name, dir] of Object.entries(await scanForSkills(root))) {
      if (!installed[name]) installed[name] = dir;
    }
  }
  return installed;
}

/**
 * Installed skills plus bundled skills; bundled wins on equal names.
 * @param {{ cacheDir?: string, homeDir?: string, bundledDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>} Mapping of skillName -> skillDirPath
 */
export async function discoverSkills({ cacheDir, homeDir = os.homedir(), bundledDir } = {}) {
  return { ...(await discoverInstalledSkills({ cacheDir, homeDir })), ...(await discoverBundledSkills({ bundledDir })) };
}

/**
 * Checks which required skills are missing from Antigravity's global skills directory.
 * @param {{ homeDir?: string, required?: string[] }} [opts]
 * @returns {Promise<string[]>} List of missing skill names
 */
export async function checkMissingSkills({ homeDir = os.homedir(), required = REQUIRED_SKILLS } = {}) {
  const skillsDir = path.join(homeDir, '.gemini', 'config', 'skills');
  const missing = [];
  for (const name of required) {
    const skillMd = path.join(skillsDir, name, 'SKILL.md');
    if (!(await exists(skillMd))) {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * Clones the official Superpowers repository into homeDir/.superpowers
 * when Claude Code is not installed.
 * @param {{ homeDir?: string, exec: (cmd: string, args: string[]) => Promise<{ code: number }> }} opts
 */
export async function installSuperpowersFromGit({ homeDir = os.homedir(), exec }) {
  const dest = path.join(homeDir, '.superpowers');
  if (await exists(dest)) return { ok: true, dest };
  if (!exec) return { ok: false, error: 'No exec function provided' };
  try {
    const res = await exec('git', ['clone', '--depth', '1', 'https://github.com/obra/superpowers.git', dest]);
    return { ok: res.code === 0, dest };
  } catch (err) {
    return { ok: false, error: /** @type {Error} */ (err).message };
  }
}

/**
 * @typedef {'created' | 'updated' | 'unchanged'} SyncAction
 * @typedef {{ skill: string, action: SyncAction, dest: string, harness: 'antigravity' | 'claude' }} SyncResult
 */

/**
 * Synchronize skills from discovered source caches into Antigravity or workspace directory.
 * @param {{
 *   homeDir?: string,
 *   targetDir?: string,
 *   cacheDir?: string,
 *   bundledDir?: string,
 *   scope?: 'global' | 'project',
 *   dryRun?: boolean,
 *   includeFallbacks?: boolean
 * }} [opts]
 * @returns {Promise<SyncResult[]>}
 */
export async function syncSkills({
  homeDir = os.homedir(),
  targetDir,
  cacheDir,
  bundledDir,
  scope = 'global',
  dryRun = false,
  includeFallbacks = false,
} = {}) {
  const project = scope === 'project' && targetDir;
  const antigravityBase = project
    ? path.join(targetDir, '.agents', 'skills')
    : path.join(homeDir, '.gemini', 'config', 'skills');
  // Claude Code loads plugin skills itself; only the package's own skills need copying.
  const claudeBase = project
    ? path.join(targetDir, '.claude', 'skills')
    : path.join(homeDir, '.claude', 'skills');

  const installed = await discoverInstalledSkills({ cacheDir, homeDir });
  const discovered = { ...installed, ...(await discoverBundledSkills({ bundledDir })) };
  /** @type {SyncResult[]} */
  const results = [];
  for (const [skill, src] of Object.entries(discovered)) {
    results.push(await syncOne(skill, src, path.join(antigravityBase, skill), 'antigravity', dryRun));
  }
  for (const [skill, src] of Object.entries(await discoverBundledSkills({ bundledDir }))) {
    results.push(await syncOne(skill, src, path.join(claudeBase, skill), 'claude', dryRun));
  }

  // Provide fallback definitions for required design skills when enabled and other skills were installed
  if (includeFallbacks && Object.keys(installed).length > 0) {
    for (const [fallbackName, content] of Object.entries(BUILTIN_FALLBACK_SKILLS)) {
      if (!discovered[fallbackName]) {
        const destDir = path.join(antigravityBase, fallbackName);
        const skillFile = path.join(destDir, 'SKILL.md');
        const alreadyThere = await exists(skillFile);
        if (!alreadyThere) {
          if (!dryRun) {
            await fs.mkdir(destDir, { recursive: true });
            await fs.writeFile(skillFile, content, 'utf8');
          }
          results.push({ skill: fallbackName, action: 'created', dest: destDir, harness: 'antigravity' });
        }
      }
    }
  }

  return results;
}

/**
 * @param {string} skill
 * @param {string} sourceDir
 * @param {string} destDir
 * @param {SyncResult['harness']} harness
 * @param {boolean} dryRun
 * @returns {Promise<SyncResult>}
 */
async function syncOne(skill, sourceDir, destDir, harness, dryRun) {
  let action = /** @type {SyncAction} */ ('unchanged');
  if (!(await exists(destDir))) action = 'created';
  else if (await isDirectoryDifferent(sourceDir, destDir)) action = 'updated';
  if (action !== 'unchanged' && !dryRun) await copyDirectory(sourceDir, destDir);
  return { skill, action, dest: destDir, harness };
}

/**
 * Bundled skills that Claude Code cannot see (missing) or sees in an old version (outdated).
 * Installed means present in ~/.claude/skills or <targetDir>/.claude/skills.
 * @param {{ homeDir?: string, targetDir?: string, bundledDir?: string }} [opts]
 * @returns {Promise<{ missing: string[], outdated: string[] }>}
 */
export async function inspectClaudeSkills({ homeDir = os.homedir(), targetDir, bundledDir } = {}) {
  const bases = [path.join(homeDir, '.claude', 'skills')];
  if (targetDir) bases.push(path.join(targetDir, '.claude', 'skills'));
  const missing = [];
  const outdated = [];
  for (const [skill, src] of Object.entries(await discoverBundledSkills({ bundledDir }))) {
    const installed = [];
    for (const base of bases) if (await exists(path.join(base, skill, 'SKILL.md'))) installed.push(path.join(base, skill));
    if (installed.length === 0) missing.push(skill);
    else if (!(await anySame(src, installed))) outdated.push(skill);
  }
  return { missing, outdated };
}

/** @param {string} src @param {string[]} dirs */
async function anySame(src, dirs) {
  for (const d of dirs) if (!(await isDirectoryDifferent(src, d))) return true;
  return false;
}

/**
 * @param {string} p
 */
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare two directories by file contents.
 * @param {string} src
 * @param {string} dest
 */
async function isDirectoryDifferent(src, dest) {
  const srcFiles = await listRelativeFiles(src);
  const destFiles = await listRelativeFiles(dest);

  if (srcFiles.length !== destFiles.length) return true;
  for (const rel of srcFiles) {
    if (!destFiles.includes(rel)) return true;
    const srcBuf = await fs.readFile(path.join(src, rel));
    const destBuf = await fs.readFile(path.join(dest, rel));
    if (!srcBuf.equals(destBuf)) return true;
  }
  return false;
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listRelativeFiles(dir) {
  const files = [];
  async function walk(current, rel = '') {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        await walk(path.join(current, e.name), childRel);
      } else if (e.isFile()) {
        files.push(childRel);
      }
    }
  }
  await walk(dir);
  return files.sort();
}

/**
 * Copy directory recursively, wiping destination first if updating.
 * @param {string} src
 * @param {string} dest
 */
async function copyDirectory(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true });
}
