// `doctor` and `upgrade`: compare a connected project with the installed standards version and bring it up to date.
// Never overwrites a file the project edited unless forced (then a .bak copy is kept), like the wizard.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStandardsConfig } from './config.js';
import { appendHook, updateGitignore, writeContent, GITIGNORE_PATTERNS } from './init.js';
import { BEGIN_MARKER, upsertManagedBlock } from './managed-block.js';
import { syncAgents } from './sync-agents.js';
import { currentTemplateHashes, hashContent, inferCodeScanning, managedTemplates, normalize, template } from './templates.js';

const AGENTS_RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'AGENTS.global.md');
const HOOKS = ['.husky/pre-commit', '.husky/pre-push'];

/**
 * @typedef {'ok'|'missing'|'outdated'|'customized'|'warning'|'error'} Status
 * @typedef {{ id: string, file: string, status: Status, message: string }} Item
 * @typedef {import('./init.js').InitResult} Result
 * @typedef {Item & { fix?: (opts: { force: boolean, dryRun: boolean }) => Promise<Result | Result[] | null> }} FixableItem
 * @typedef {{ connected: boolean, items: Item[] }} Report
 */

const MESSAGES = {
  ok: 'up to date',
  missing: 'missing; `upgrade` adds it',
  outdated: 'older version that was never edited; `upgrade` replaces it',
  customized: 'differs from the current template (edited here, or set up before v1.3). Review it, or run `upgrade --force` (keeps a .bak copy)',
};

/**
 * @param {{ targetDir: string, homeDir?: string, which?: (bin: string) => Promise<boolean> }} opts
 * @returns {Promise<Report>}
 */
export async function inspectProject(opts) {
  const { connected, items } = await collect(opts);
  return { connected, items: items.map(({ id, file, status, message }) => ({ id, file, status, message })) };
}

/**
 * Applies every safe fix. Customized files are only replaced with `force`.
 * @param {{ targetDir: string, homeDir?: string, force?: boolean, dryRun?: boolean }} opts
 * @returns {Promise<Result[]>}
 */
export async function upgradeProject({ targetDir, homeDir = os.homedir(), force = false, dryRun = false }) {
  const { connected, items, config } = await collect({ targetDir, homeDir });
  if (!connected) throw new Error(items[0].message);

  /** @type {Result[]} */
  const results = [];
  for (const item of items) {
    if (!item.fix || item.status === 'ok') continue;
    const outcome = await item.fix({ force, dryRun });
    if (outcome) results.push(...(Array.isArray(outcome) ? outcome : [outcome]));
  }

  // Record the scanner and fingerprints of everything that now equals its template.
  const configFile = path.join(targetDir, '.standardsrc.json');
  const next = { ...config, managed: { ...(config.managed ?? {}) } };
  if (!dryRun) Object.assign(next.managed, await currentTemplateHashes(targetDir, next));
  const before = await fs.readFile(configFile, 'utf8');
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (before !== after) {
    if (!dryRun) await fs.writeFile(configFile, after);
    results.push({ file: configFile, action: 'updated', note: 'recorded template versions' });
  }
  return results;
}

/**
 * @param {{ targetDir: string, homeDir?: string, which?: (bin: string) => Promise<boolean> }} opts
 */
async function collect({ targetDir, homeDir = os.homedir(), which }) {
  const at = (/** @type {string} */ rel) => path.join(targetDir, rel);
  const pkg = await readJsonOrNull(at('package.json'));
  const hasDependency = Boolean(pkg?.devDependencies?.['@oneup4real/standards'] ?? pkg?.dependencies?.['@oneup4real/standards']);
  const hasConfig = await exists(at('.standardsrc.json'));
  if (!hasDependency || !hasConfig) {
    return {
      connected: false,
      config: {},
      /** @type {FixableItem[]} */
      items: [{
        id: 'connection', file: hasDependency ? '.standardsrc.json' : 'package.json', status: /** @type {Status} */ ('error'),
        message: 'This project is not connected to @oneup4real/standards yet. Run: npx oneup-standards init',
      }],
    };
  }

  const config = await readStandardsConfig(targetDir);
  config.codeScanning ??= inferCodeScanning(await readOrNull(at('.github/workflows/ci.yml')));
  const usesHooks = await exists(at('.husky'));

  /** @type {FixableItem[]} */
  const items = [];
  for (const managed of await managedTemplates(targetDir, config)) items.push(await inspectManaged(targetDir, config, managed));
  if (usesHooks) for (const hook of HOOKS) items.push(await inspectHook(targetDir, hook));
  items.push(await inspectAgents(targetDir, homeDir));
  items.push(await inspectGitignore(targetDir));
  items.push(await inspectScripts(targetDir, pkg, usesHooks));
  const hasGemini = await exists(path.join(homeDir, '.gemini'));
  if (hasGemini) items.push(await inspectSkills(homeDir));
  if (usesHooks && which && !(await which('gitleaks'))) {
    items.push({
      id: 'gitleaks', file: '(this machine)', status: 'warning',
      message: 'gitleaks is not installed, so the pre-commit hook will refuse to commit. Install: brew install gitleaks (Windows: winget install gitleaks)',
    });
  }
  return { connected: true, config, items };
}

/**
 * @param {string} targetDir
 * @param {import('./config.js').StandardsConfig} config
 * @param {import('./templates.js').ManagedTemplate} managed
 * @returns {Promise<FixableItem>}
 */
async function inspectManaged(targetDir, config, { rel, content }) {
  const file = path.join(targetDir, rel);
  const actual = await readOrNull(file);
  /** @type {Status} */
  let status;
  if (actual === null) status = 'missing';
  else if (normalize(actual) === normalize(content)) status = 'ok';
  else if (config.managed?.[rel] === hashContent(actual)) status = 'outdated';
  else status = 'customized';

  return {
    id: `file:${rel}`, file: rel, status, message: MESSAGES[status],
    fix: async ({ force, dryRun }) => {
      if (status === 'customized' && !force) return { file, action: 'skipped', note: 'edited in this project; use --force to replace (keeps a .bak copy)' };
      const action = status === 'missing' ? 'created' : status === 'customized' ? 'overwritten' : 'updated';
      if (dryRun) return { file, action };
      if (status === 'customized' && actual !== null) await fs.writeFile(`${file}.bak`, actual);
      const result = await writeContent(file, content, action);
      return status === 'customized' ? { ...result, note: `previous version saved as ${path.basename(file)}.bak` } : result;
    },
  };
}

/**
 * @param {string} targetDir
 * @param {string} rel
 * @returns {Promise<FixableItem>}
 */
async function inspectHook(targetDir, rel) {
  const file = path.join(targetDir, rel);
  const line = await template(rel);
  const existing = await readOrNull(file);
  const present = existing !== null && existing.split(/\r?\n/).some((l) => l.trim() === line.trim());
  return {
    id: `hook:${rel}`, file: rel, status: present ? 'ok' : 'missing',
    message: present ? MESSAGES.ok : 'the standards check is not in this hook; `upgrade` appends it (your commands stay)',
    fix: async ({ dryRun }) => (dryRun ? { file, action: existing === null ? 'created' : 'updated' } : appendHook(file, line)),
  };
}

/**
 * @param {string} targetDir
 * @param {string} homeDir
 * @returns {Promise<FixableItem>}
 */
async function inspectAgents(targetDir, homeDir) {
  const file = path.join(targetDir, 'AGENTS.md');
  const existing = await readOrNull(file);
  const rules = await fs.readFile(AGENTS_RULES, 'utf8');
  const pointers = await Promise.all(['CLAUDE.md', 'GEMINI.md'].map(async (name) => {
    const text = await readOrNull(path.join(targetDir, name));
    return text !== null && text.split(/\r?\n/).some((l) => l.trim() === '@AGENTS.md');
  }));

  /** @type {Status} */
  let status;
  let message;
  if (existing === null || !existing.includes(BEGIN_MARKER)) {
    status = 'missing';
    message = 'the shared AI rules are not in AGENTS.md; `upgrade` adds them as a marked block (your text stays)';
  } else if (upsertManagedBlock(existing, rules) !== existing) {
    status = 'outdated';
    message = 'the shared AI rules block is from an older version; `upgrade` refreshes it (your text outside the block stays)';
  } else if (pointers.includes(false)) {
    status = 'missing';
    message = 'CLAUDE.md or GEMINI.md does not point to AGENTS.md; `upgrade` adds the pointer';
  } else {
    status = 'ok';
    message = MESSAGES.ok;
  }
  return {
    id: 'agents', file: 'AGENTS.md', status, message,
    fix: async ({ dryRun }) => {
      if (dryRun) return { file, action: existing === null ? 'created' : 'updated' };
      return (await syncAgents({ targetDir, global: false, homeDir })).filter((r) => r.action !== 'unchanged');
    },
  };
}

/**
 * @param {string} targetDir
 * @returns {Promise<FixableItem>}
 */
async function inspectGitignore(targetDir) {
  const file = path.join(targetDir, '.gitignore');
  const existing = await readOrNull(file);
  const lines = new Set((existing ?? '').split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_PATTERNS.filter((p) => !lines.has(p));
  return {
    id: 'gitignore', file: '.gitignore', status: missing.length === 0 ? 'ok' : 'missing',
    message: missing.length === 0 ? MESSAGES.ok : `missing patterns for secrets/documents: ${missing.join(' ')}; \`upgrade\` appends them`,
    fix: async ({ dryRun }) => (dryRun ? { file, action: existing === null ? 'created' : 'updated' } : updateGitignore(file)),
  };
}

/**
 * @param {string} targetDir
 * @param {Record<string, any>} pkg
 * @param {boolean} usesHooks
 * @returns {Promise<FixableItem>}
 */
async function inspectScripts(targetDir, pkg, usesHooks) {
  const file = path.join(targetDir, 'package.json');
  /** @type {Record<string, string>} */
  const wanted = { lint: 'eslint .', 'check:arch': 'depcruise src --config .dependency-cruiser.cjs' };
  if (usesHooks) wanted.prepare = 'husky';
  const missing = Object.keys(wanted).filter((name) => !pkg.scripts?.[name]);
  return {
    id: 'scripts', file: 'package.json', status: missing.length === 0 ? 'ok' : 'missing',
    message: missing.length === 0 ? MESSAGES.ok : `missing scripts: ${missing.join(', ')}; \`upgrade\` adds them`,
    fix: async ({ dryRun }) => {
      if (dryRun) return { file, action: 'updated' };
      // Re-read: earlier fixes in the same run must not be lost.
      const current = (await readJsonOrNull(file)) ?? {};
      current.scripts = { ...(current.scripts ?? {}) };
      for (const name of missing) current.scripts[name] ??= wanted[name];
      await fs.writeFile(file, `${JSON.stringify(current, null, 2)}\n`);
      return { file, action: 'updated', note: `added ${missing.join(', ')}` };
    },
  };
}

/**
 * @param {string} homeDir
 * @returns {Promise<FixableItem>}
 */
async function inspectSkills(homeDir) {
  const { checkMissingSkills, syncSkills } = await import('./sync-skills.js');
  const missing = await checkMissingSkills({ homeDir });
  const status = missing.length === 0 ? 'ok' : 'missing';
  return {
    id: 'skills',
    file: '~/.gemini/config/skills',
    status,
    message: status === 'ok'
      ? MESSAGES.ok
      : `missing required AI skills (${missing.join(', ')}); \`upgrade\` or \`sync-skills\` synchronizes them into Antigravity`,
    fix: async ({ dryRun }) => {
      if (dryRun) return { file: path.join(homeDir, '.gemini', 'config', 'skills'), action: 'created' };
      const synced = await syncSkills({ homeDir, scope: 'global' });
      return synced.map((s) => ({ file: s.dest, action: s.action, note: `synced ${s.skill}` }));
    },
  };
}

/** @param {string} file */
function exists(file) {
  return fs.access(file).then(() => true, () => false);
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

/** @param {string} file */
async function readJsonOrNull(file) {
  const text = await readOrNull(file);
  return text === null ? null : JSON.parse(text);
}

