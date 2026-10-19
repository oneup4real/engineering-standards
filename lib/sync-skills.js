// Discovers and synchronizes AI skills across harness caches and Antigravity.
// Ensures skills installed in Claude Code or other plugins are available
// to Antigravity without sandbox policy violations or manual copy-paste drift.
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
 * Plugin-cache skills plus bundled skills; bundled wins on equal names.
 * @param {{ cacheDir?: string, homeDir?: string, bundledDir?: string }} [opts]
 * @returns {Promise<Record<string, string>>} Mapping of skillName -> skillDirPath
 */
export async function discoverSkills({ cacheDir, homeDir = os.homedir(), bundledDir } = {}) {
  const root = cacheDir || path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official');
  return { ...(await scanForSkills(root)), ...(await discoverBundledSkills({ bundledDir })) };
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
 *   dryRun?: boolean
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
} = {}) {
  const project = scope === 'project' && targetDir;
  const antigravityBase = project
    ? path.join(targetDir, '.agents', 'skills')
    : path.join(homeDir, '.gemini', 'config', 'skills');
  // Claude Code loads plugin skills itself; only the package's own skills need copying.
  const claudeBase = project
    ? path.join(targetDir, '.claude', 'skills')
    : path.join(homeDir, '.claude', 'skills');

  /** @type {SyncResult[]} */
  const results = [];
  for (const [skill, src] of Object.entries(await discoverSkills({ cacheDir, homeDir, bundledDir }))) {
    results.push(await syncOne(skill, src, path.join(antigravityBase, skill), 'antigravity', dryRun));
  }
  for (const [skill, src] of Object.entries(await discoverBundledSkills({ bundledDir }))) {
    results.push(await syncOne(skill, src, path.join(claudeBase, skill), 'claude', dryRun));
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
