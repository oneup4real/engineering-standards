// Keeps agent instruction files for all AI tools in sync with the canonical rules in agents/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertManagedBlock } from './managed-block.js';

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');
const CURRENT_STATE_HEADING = '## Current state vs. target';

/** @typedef {{ file: string, action: 'created'|'updated'|'unchanged' }} SyncResult */

/**
 * @param {{ targetDir: string, global: boolean, homeDir: string }} opts
 * @returns {Promise<SyncResult[]>}
 */
export async function syncAgents({ targetDir, global, homeDir }) {
  const rules = await fs.readFile(path.join(AGENTS_DIR, 'AGENTS.global.md'), 'utf8');

  if (global) {
    const canonical = path.join(homeDir, '.agents', 'AGENTS.md');
    // Absolute paths: `~` expansion in imports is not supported by every tool.
    const pointer = `@${canonical}`;
    return [
      await writeBlock(canonical, rules),
      await writePointer(path.join(homeDir, '.claude', 'CLAUDE.md'), pointer),
      await writePointer(path.join(homeDir, '.gemini', 'GEMINI.md'), pointer),
      // Codex has no import syntax, so it gets a full copy.
      await writeBlock(path.join(homeDir, '.codex', 'AGENTS.md'), rules),
    ];
  }

  const agentsFile = path.join(targetDir, 'AGENTS.md');
  const existing = await readOrNull(agentsFile);
  const prefix = existing === null ? await projectTemplate() : null;
  return [
    await writeBlock(agentsFile, rules, prefix),
    await writePointer(path.join(targetDir, 'CLAUDE.md'), '@AGENTS.md'),
    await writePointer(path.join(targetDir, 'GEMINI.md'), '@AGENTS.md'),
  ];
}

async function projectTemplate() {
  const template = await fs.readFile(path.join(AGENTS_DIR, 'AGENTS.project.md'), 'utf8');
  if (!template.includes(CURRENT_STATE_HEADING)) throw new Error('AGENTS.project.md lost its current-state section');
  return template;
}

/**
 * @param {string} file
 * @param {string} block
 * @param {string | null} [prefixForNewFile] content placed before the block when the file is created
 * @returns {Promise<SyncResult>}
 */
async function writeBlock(file, block, prefixForNewFile = null) {
  const existing = await readOrNull(file);
  const base = existing ?? prefixForNewFile;
  const next = upsertManagedBlock(base, block);
  return writeIfChanged(file, existing, next);
}

/**
 * Ensures the file imports `target`. A file that already contains the import is left alone.
 * @param {string} file
 * @param {string} importLine
 * @returns {Promise<SyncResult>}
 */
async function writePointer(file, importLine) {
  const existing = await readOrNull(file);
  if (existing === null) return writeIfChanged(file, null, `${importLine}\n`);
  if (existing.split(/\r?\n/).some((line) => line.trim() === importLine)) {
    return { file, action: 'unchanged' };
  }
  return writeIfChanged(file, existing, upsertManagedBlock(existing, importLine));
}

/**
 * @param {string} file
 * @param {string | null} existing
 * @param {string} next
 * @returns {Promise<SyncResult>}
 */
async function writeIfChanged(file, existing, next) {
  if (existing === next) return { file, action: 'unchanged' };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  return { file, action: existing === null ? 'created' : 'updated' };
}

/** @param {string} file */
async function readOrNull(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}
