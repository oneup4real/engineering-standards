// Discovers and synchronizes AI skills across harness caches and Antigravity.
// Ensures skills installed in Claude Code, local git clones, or other plugins
// are available to Antigravity without sandbox policy violations or manual drift.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
 * Recursively find all skill directories containing SKILL.md.
 * Scans Claude plugin caches, local .superpowers clones, and workspace skills.
 * @param {{ cacheDir?: string, homeDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>} Mapping of skillName -> skillDirPath
 */
export async function discoverSkills({ cacheDir, homeDir = os.homedir() } = {}) {
  /** @type {Record<string, string>} */
  const skills = {};

  const roots = [];
  if (cacheDir) {
    roots.push(cacheDir);
  } else {
    // 1. All Claude plugins cache directories (scans all marketplaces including superpowers-marketplace)
    roots.push(path.join(homeDir, '.claude', 'plugins', 'cache'));
    // 2. Standalone superpowers directory
    roots.push(path.join(homeDir, '.superpowers'));
    // 3. User global agents skills
    roots.push(path.join(homeDir, '.agents', 'skills'));
  }

  // Search directories under each root looking for folders that contain SKILL.md
  async function scan(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const skillName = path.basename(dir);
      if (!skills[skillName]) {
        skills[skillName] = dir;
      }
      return;
    }

    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        await scan(path.join(dir, e.name), depth + 1);
      }
    }
  }

  for (const r of roots) {
    if (await exists(r)) {
      await scan(r, 0);
    }
  }

  return skills;
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
 * @typedef {{ skill: string, action: SyncAction, dest: string }} SyncResult
 */

/**
 * Synchronize skills from discovered source caches into Antigravity or workspace directory.
 * @param {{
 *   homeDir?: string,
 *   targetDir?: string,
 *   cacheDir?: string,
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
  scope = 'global',
  dryRun = false,
  includeFallbacks = false,
} = {}) {
  const discovered = await discoverSkills({ cacheDir, homeDir });
  const destBase = scope === 'project' && targetDir
    ? path.join(targetDir, '.agents', 'skills')
    : path.join(homeDir, '.gemini', 'config', 'skills');

  /** @type {SyncResult[]} */
  const results = [];

  for (const [skillName, sourceDir] of Object.entries(discovered)) {
    const destDir = path.join(destBase, skillName);
    const destExists = await exists(destDir);

    let action = /** @type {SyncAction} */ ('unchanged');
    if (!destExists) {
      action = 'created';
    } else {
      const isDiff = await isDirectoryDifferent(sourceDir, destDir);
      if (isDiff) action = 'updated';
    }

    if (action !== 'unchanged' && !dryRun) {
      await copyDirectory(sourceDir, destDir);
    }

    results.push({ skill: skillName, action, dest: destDir });
  }

  // Provide fallback definitions for required design skills if explicitly enabled or if syncing global skills
  if (includeFallbacks && results.length > 0) {
    for (const [fallbackName, content] of Object.entries(BUILTIN_FALLBACK_SKILLS)) {
      if (!discovered[fallbackName]) {
        const destDir = path.join(destBase, fallbackName);
        const skillFile = path.join(destDir, 'SKILL.md');
        const alreadyThere = await exists(skillFile);
        if (!alreadyThere) {
          if (!dryRun) {
            await fs.mkdir(destDir, { recursive: true });
            await fs.writeFile(skillFile, content, 'utf8');
          }
          results.push({ skill: fallbackName, action: 'created', dest: destDir });
        }
      }
    }
  }

  return results;
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
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true });
}
