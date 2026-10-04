// `doctor` and `upgrade`: compare a connected project with the installed standards version and bring it up to date.
// Never overwrites a file the project edited unless forced (then a .bak copy is kept), like the wizard.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStandardsConfig } from './config.js';
import { appendHook, updateGitignore, writeContent, GITIGNORE_PATTERNS } from './init.js';
import { BEGIN_MARKER, upsertManagedBlock } from './managed-block.js';
import { mergeTemplateFile } from './mergers.js';
import { syncAgents } from './sync-agents.js';
import { currentTemplateHashes, hashContent, inferCodeScanning, managedTemplates, normalize, template } from './templates.js';

const AGENTS_RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'AGENTS.global.md');
const HOOKS = ['.husky/pre-commit', '.husky/pre-push'];

/**
 * @typedef {'ok'|'missing'|'outdated'|'customized'|'warning'|'error'} Status
 * @typedef {{ id: string, file: string, status: Status, message: string }} Item
 * @typedef {import('./init.js').InitResult & { mergedRel?: string, mergedHash?: string }} Result
 * @typedef {Item & { fix?: (opts: { force: boolean, dryRun: boolean, merge?: boolean }) => Promise<Result | Result[] | null> }} FixableItem
 * @typedef {{ connected: boolean, items: Item[] }} Report
 */

const MESSAGES = {
  ok: 'up to date',
  missing: 'missing; `upgrade` adds it',
  outdated: 'older version that was never edited; `upgrade` replaces it',
  customized: 'differs from the current template (edited here, or set up before v1.3). Review it, or run `upgrade --merge` / `upgrade --force` (keeps a .bak copy)',
};

/**
 * @param {{ targetDir: string, homeDir?: string, which?: (bin: string) => Promise<boolean> }} opts
 * @returns {Promise<Report>}
 */
export async function inspectProject(opts) {
  const { connected, items, config } = await collect(opts);
  const ratchets = connected ? await inspectRatchets(opts.targetDir, config) : [];
  return { connected, items: items.map(({ id, file, status, message }) => ({ id, file, status, message })), ratchets };
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   file: string,
 *   count: number,
 *   details?: string,
 * }} RatchetItem
 */

/**
 * Inspects monotonic ratchets and legacy debt files in the target directory.
 * @param {string} targetDir
 * @param {import("./config.js").StandardsConfig} [config]
 * @returns {Promise<RatchetItem[]>}
 */
export async function inspectRatchets(targetDir, config = {}) {
  const ratchets = [];
  const at = (rel) => path.join(targetDir, rel);

  // 1. ESLint suppressions
  const eslintSuppFile = ".eslint-suppressions.json";
  const eslintContent = await readJsonOrNull(at(eslintSuppFile));
  if (eslintContent !== null) {
    let count = 0;
    let files = 0;
    for (const rules of Object.values(eslintContent)) {
      files++;
      if (rules && typeof rules === "object") {
        for (const val of Object.values(rules)) {
          if (typeof val?.count === "number") count += val.count;
          else if (typeof val === "number") count += val;
        }
      }
    }
    ratchets.push({
      id: "eslint",
      name: "ESLint suppressions",
      file: eslintSuppFile,
      count,
      details: `${count} violation${count === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"}`,
    });
  }

  // 2. Dependency Cruiser known violations
  const depcruiseFile = ".dependency-cruiser-known-violations.json";
  const depcruiseContent = await readJsonOrNull(at(depcruiseFile));
  if (depcruiseContent !== null) {
    const list = Array.isArray(depcruiseContent.violations)
      ? depcruiseContent.violations
      : Array.isArray(depcruiseContent) ? depcruiseContent : [];
    const count = list.length;
    ratchets.push({
      id: "arch-layers",
      name: "Architecture layer violations",
      file: depcruiseFile,
      count,
      details: `${count} violation${count === 1 ? "" : "s"}`,
    });
  }

  // 3. Direct DB Writes allowlist
  const ratchetsDir = config?.ratchetsDir ? at(config.ratchetsDir) : null;
  const allowlistPaths = [at("arch-allowlist.json"), at("scripts/arch-allowlist.json")];
  if (ratchetsDir) allowlistPaths.unshift(path.join(ratchetsDir, "arch-allowlist.json"));

  for (const allowPath of allowlistPaths) {
    const allowContent = await readJsonOrNull(allowPath);
    if (allowContent !== null) {
      let count = 0;
      for (const [k, v] of Object.entries(allowContent)) {
        if (k.startsWith("_")) continue;
        if (typeof v === "number") count += v;
        else if (Array.isArray(v)) count += v.length;
        else if (v) count += 1;
      }
      ratchets.push({
        id: "db-writes",
        name: "Direct DB writes allowlist",
        file: path.relative(targetDir, allowPath),
        count,
        details: `${count} allowed direct write${count === 1 ? "" : "s"}`,
      });
      break;
    }
  }

  // 4. Action Gaps allowlist
  const gapPaths = [at("arch-action-gaps.json"), at("scripts/arch-action-gaps.json")];
  if (ratchetsDir) gapPaths.unshift(path.join(ratchetsDir, "arch-action-gaps.json"));

  for (const gapPath of gapPaths) {
    const gapContent = await readJsonOrNull(gapPath);
    if (gapContent !== null) {
      let count = 0;
      for (const [k, v] of Object.entries(gapContent)) {
        if (k.startsWith("_")) continue;
        if (typeof v === "number") count += v;
        else if (Array.isArray(v)) count += v.length;
        else if (v) count += 1;
      }
      ratchets.push({
        id: "action-gaps",
        name: "Unguarded server actions",
        file: path.relative(targetDir, gapPath),
        count,
        details: `${count} action gap${count === 1 ? "" : "s"}`,
      });
      break;
    }
  }

  return ratchets;
}


/**
 * Applies every safe fix. Customized files are merged with `merge` or replaced with `force`.
 * @param {{ targetDir: string, homeDir?: string, force?: boolean, dryRun?: boolean, merge?: boolean }} opts
 * @returns {Promise<Result[]>}
 */
export async function upgradeProject({ targetDir, homeDir = os.homedir(), force = false, dryRun = false, merge = false }) {
  const { connected, items, config } = await collect({ targetDir, homeDir });
  if (!connected) throw new Error(items[0].message);

  /** @type {Result[]} */
  const results = [];
  /** @type {Record<string, string>} */
  const mergedEntries = {};
  for (const item of items) {
    if (!item.fix || item.status === 'ok') continue;
    const outcome = await item.fix({ force, dryRun, merge });
    if (outcome) {
      const list = Array.isArray(outcome) ? outcome : [outcome];
      results.push(...list);
      for (const res of list) {
        if (res.mergedRel && res.mergedHash) {
          mergedEntries[res.mergedRel] = res.mergedHash;
        }
      }
    }
  }

  // Record the scanner and fingerprints of everything that now equals its template or was merged.
  const configFile = path.join(targetDir, '.standardsrc.json');
  const next = {
    ...config,
    managed: { ...(config.managed ?? {}) },
    merged: { ...(config.merged ?? {}), ...mergedEntries },
  };
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
  else if (config.merged?.[rel] === hashContent(actual)) status = 'ok';
  else if (config.managed?.[rel] === hashContent(actual)) status = 'outdated';
  else status = 'customized';

  return {
    id: `file:${rel}`, file: rel, status, message: MESSAGES[status],
    fix: async ({ force, dryRun, merge }) => {
      if (status === 'customized' && merge) {
        const { canMerge, mergedContent, hasChanges } = mergeTemplateFile(rel, actual, content);
        if (!canMerge) {
          return { file, action: 'skipped', note: 'no automated merge strategy for this file type; use --force to replace' };
        }
        if (!hasChanges) {
          return {
            file,
            action: 'unchanged',
            note: 'already contains all standard sections/jobs; recorded as up to date',
            mergedRel: rel,
            mergedHash: hashContent(actual),
          };
        }
        if (dryRun) return { file, action: 'merged' };
        await fs.writeFile(`${file}.bak`, actual);
        await fs.writeFile(file, mergedContent);
        return {
          file,
          action: 'merged',
          note: `merged with central template (backup saved as ${path.basename(file)}.bak)`,
          mergedRel: rel,
          mergedHash: hashContent(mergedContent),
        };
      }
      if (status === 'customized' && !force) return { file, action: 'skipped', note: 'edited in this project; use --merge to combine or --force to replace (keeps a .bak copy)' };
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

