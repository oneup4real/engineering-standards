// Discovers and synchronizes AI skills across harness caches and Antigravity.
// Ensures skills installed in Claude Code or other plugins are available
// to Antigravity without sandbox policy violations or manual copy-paste drift.
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

/**
 * Recursively find all skill directories containing SKILL.md.
 * @param {{ cacheDir?: string, homeDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>} Mapping of skillName -> skillDirPath
 */
export async function discoverSkills({ cacheDir, homeDir = os.homedir() } = {}) {
  const root = cacheDir || path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official');
  /** @type {Record<string, string>} */
  const skills = {};

  if (!(await exists(root))) return skills;

  // Search directories under root looking for folders that contain SKILL.md
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
      // If already discovered, newer/higher version (or first found) wins
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

  await scan(root);
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
 *   dryRun?: boolean
 * }} [opts]
 * @returns {Promise<SyncResult[]>}
 */
export async function syncSkills({
  homeDir = os.homedir(),
  targetDir,
  cacheDir,
  scope = 'global',
  dryRun = false,
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
