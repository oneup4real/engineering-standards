// Writes the consumer files that connect a project to @oneup4real/standards.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProject } from './detect.js';
import { syncAgents } from './sync-agents.js';

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'consumer');

export const STANDARDS_DEPENDENCY = 'github:oneup4real/engineering-standards#semver:^1.0.0';

export const GITIGNORE_PATTERNS = ['.env*', '!.env.example', '*.pem', '*.p12', '*.pfx', '*.key', '*.docx', '*.doc', '*.xlsx', '*.xls', '*.pptx', '*.pdf', '*service-account*.json', '*serviceAccount*.json'];

/**
 * @typedef {{
 *   eslint: 'replace'|'merge'|'skip', ci: 'replace'|'skip', hooks: boolean, agents: boolean,
 *   updateMode: 'review'|'auto'|'never', codeScanning: 'codeql'|'semgrep', bundleMarkers?: string[]
 * }} Answers
 * @typedef {{ file: string, action: 'created'|'skipped'|'overwritten'|'merged'|'updated'|'unchanged', note?: string }} InitResult
 */

/** @type {Answers} */
export const RECOMMENDED_ANSWERS = Object.freeze({
  eslint: 'merge',
  ci: 'replace',
  hooks: true,
  agents: true,
  updateMode: 'review',
  codeScanning: 'semgrep',
});

/**
 * @param {{ targetDir: string, answers: Answers, homeDir?: string }} opts
 * @returns {Promise<InitResult[]>}
 */
export async function initProject({ targetDir, answers, homeDir = os.homedir() }) {
  const info = await detectProject(targetDir);
  const has = (/** @type {string} */ target) => info.existing.includes(target);
  /** @type {InitResult[]} */
  const results = [];
  const out = (/** @type {string} */ rel) => path.join(targetDir, rel);

  results.push(await setUpEslint(targetDir, info.found['eslint.config.mjs'], answers.eslint));

  results.push(await writeUnlessExists('.dependency-cruiser.cjs', has, targetDir));

  // Vitest only where the project uses it or has no test runner yet.
  const scripts = info.packageJson?.scripts ?? {};
  const usesVitest = Boolean(info.packageJson?.devDependencies?.vitest || info.packageJson?.dependencies?.vitest);
  const runsVitest = usesVitest || !scripts.test;
  if (runsVitest) {
    results.push(await writeUnlessExists('vitest.config.ts', has, targetDir));
  } else {
    results.push({ file: out('vitest.config.ts'), action: 'skipped', note: `test script "${scripts.test}" kept` });
  }

  // Project config first: CI depends on whether bundle markers exist.
  const configFile = out('.standardsrc.json');
  const previous = (await readJson(configFile)) ?? {};
  const markers = [...new Set([...(previous.bundleForbiddenMarkers ?? []), ...(answers.bundleMarkers ?? [])])];
  const config = { bundleDir: '.next/static', ...previous, bundleForbiddenMarkers: markers, updateMode: answers.updateMode };

  // CI. "never" pins the exact release; otherwise the moving major tag delivers fixes automatically.
  const ref = answers.updateMode === 'never' ? `v${await standardsVersion()}` : 'v1';
  const ciContent = (await template('.github/workflows/ci.yml'))
    .replaceAll('@v1', `@${ref}`)
    .replace('{{CODEQL}}', String(answers.codeScanning === 'codeql'))
    .replace('{{SEMGREP}}', String(answers.codeScanning === 'semgrep'))
    .replace('{{BUNDLE_CHECK}}', String(markers.length > 0));
  const ciFile = out('.github/workflows/ci.yml');
  if (has('.github/workflows/ci.yml') && answers.ci === 'skip') {
    results.push({ file: ciFile, action: 'skipped' });
  } else if (has('.github/workflows/ci.yml')) {
    const existingCi = await fs.readFile(out(info.found['.github/workflows/ci.yml']), 'utf8');
    if (existingCi === ciContent) {
      results.push({ file: ciFile, action: 'unchanged' });
    } else {
      await fs.writeFile(`${ciFile}.bak`, existingCi);
      results.push({ ...(await writeContent(ciFile, ciContent, 'overwritten')), note: 'previous version saved as ci.yml.bak' });
    }
  } else {
    results.push(await writeContent(ciFile, ciContent, 'created'));
  }

  // Dependabot: never replace an existing file (it may cover other ecosystems or folders).
  const ignore = answers.updateMode === 'never' ? '    ignore:\n      - dependency-name: "@oneup4real/standards"\n' : '';
  const dependabot = (await template('.github/dependabot.yml')).replace('{{STANDARDS_IGNORE}}\n', ignore);
  if (has('.github/dependabot.yml')) {
    results.push({ file: out('.github/dependabot.yml'), action: 'skipped', note: 'existing file kept; make sure it has npm + github-actions entries' });
  } else {
    results.push(await writeContent(out('.github/dependabot.yml'), dependabot, 'created'));
  }
  if (answers.updateMode === 'auto') {
    results.push(await writeTemplate('.github/workflows/standards-automerge.yml', out('.github/workflows/standards-automerge.yml'), 'created'));
  }

  // Hooks
  if (answers.hooks) {
    for (const hook of ['.husky/pre-commit', '.husky/pre-push']) {
      results.push(await appendHook(out(hook), await template(hook)));
    }
    results.push(await writeUnlessExists('.lintstagedrc.json', has, targetDir));
  }

  results.push(await writeUnlessExists('.github/pull_request_template.md', has, targetDir));

  // Architecture test kit (+ empty ratchet files, which may only shrink)
  if (runsVitest) {
    results.push(await writeUnlessExists('tests/arch/standards.test.ts', has, targetDir));
  } else {
    results.push({ file: out('tests/arch/standards.test.ts'), action: 'skipped', note: 'needs Vitest; migrate the test runner to use the architecture test kit' });
  }
  for (const ratchet of ['arch-allowlist.json', 'arch-action-gaps.json']) {
    const file = out(ratchet);
    if (!(await fs.access(file).then(() => true, () => false))) results.push(await writeContent(file, '{}\n', 'created'));
  }

  results.push(await writeContent(configFile, `${JSON.stringify(config, null, 2)}\n`, has('.standardsrc.json') ? 'updated' : 'created'));

  results.push(await updatePackageJson(out('package.json'), { addVitest: runsVitest, hooks: answers.hooks }));
  results.push(await updateGitignore(out('.gitignore')));

  if (answers.agents) {
    for (const r of await syncAgents({ targetDir, global: false, homeDir })) results.push(r);
  }
  return results;
}

const MERGE_MARKER = '@oneup4real/standards/eslint/';

/**
 * ESLint setup. Never deletes a user config: replaced files are kept as <name>.bak, merged ones as eslint.config.local.*.
 * @param {string} targetDir
 * @param {string | undefined} existingName file name found by detectProject
 * @param {Answers['eslint']} answer
 * @returns {Promise<InitResult>}
 */
async function setUpEslint(targetDir, existingName, answer) {
  const out = (/** @type {string} */ rel) => path.join(targetDir, rel);
  const target = out('eslint.config.mjs');
  if (!existingName) return writeTemplate('eslint.config.mjs', target, 'created');

  const existing = await fs.readFile(out(existingName), 'utf8');
  if (existingName === 'eslint.config.mjs' && existing.includes(MERGE_MARKER)) {
    return { file: target, action: 'unchanged', note: 'already uses the shared rules' };
  }
  if (answer === 'skip') return { file: out(existingName), action: 'skipped' };

  const isFlat = existingName.startsWith('eslint.config.');
  if (answer === 'merge' && isFlat) {
    const localName = `eslint.config.local${path.extname(existingName)}`;
    if (await fileExists(out(localName))) {
      return { file: target, action: 'skipped', note: `${localName} already exists; merge by hand` };
    }
    await fs.rename(out(existingName), out(localName));
    const merged = (await template('eslint.config.merge.mjs')).replace('./eslint.config.local.mjs', `./${localName}`);
    await fs.writeFile(target, merged);
    return { file: target, action: 'merged', note: `previous config kept in ${localName}` };
  }

  // Replace, or merge of a legacy .eslintrc (not loadable from a flat config): keep a backup, then write ours.
  await fs.rename(out(existingName), out(`${existingName}.bak`));
  const result = await writeTemplate('eslint.config.mjs', target, 'overwritten');
  const why = isFlat ? '' : 'legacy .eslintrc format cannot be merged; ';
  return { ...result, note: `${why}previous config saved as ${existingName}.bak` };
}

/**
 * Adds our hook command to a husky hook, keeping whatever the hook already runs.
 * @param {string} file
 * @param {string} line
 * @returns {Promise<InitResult>}
 */
async function appendHook(file, line) {
  const existing = await fs.readFile(file, 'utf8').catch(() => null);
  if (existing === null) return writeContent(file, line, 'created', 0o755);
  const command = line.trim();
  if (existing.split(/\r?\n/).some((l) => l.trim() === command)) return { file, action: 'unchanged' };
  const next = `${existing}${existing.endsWith('\n') ? '' : '\n'}${line}`;
  await fs.writeFile(file, next);
  return { file, action: 'updated', note: 'standards check appended to your existing hook' };
}

async function standardsVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, '..', '..', 'package.json'), 'utf8'));
  return pkg.version;
}

/** @param {string} file */
function fileExists(file) {
  return fs.access(file).then(() => true, () => false);
}

/**
 * @param {string} rel
 * @param {(target: string) => boolean} has
 * @param {string} targetDir
 */
async function writeUnlessExists(rel, has, targetDir) {
  const dest = path.join(targetDir, rel);
  if (has(rel)) return { file: dest, action: /** @type {const} */ ('skipped') };
  return writeTemplate(rel, dest, 'created');
}

/**
 * @param {string} rel template path
 * @param {string} dest absolute destination
 * @param {InitResult['action']} action
 */
async function writeTemplate(rel, dest, action) {
  return writeContent(dest, await template(rel), action);
}

/**
 * @param {string} file
 * @param {string} content
 * @param {InitResult['action']} action
 * @param {number} [mode]
 * @returns {Promise<InitResult>}
 */
async function writeContent(file, content, action, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, mode ? { mode } : undefined);
  return { file, action };
}

/** @param {string} rel */
function template(rel) {
  return fs.readFile(path.join(TEMPLATE_DIR, rel), 'utf8');
}

/**
 * @param {string} file
 * @param {{ addVitest: boolean, hooks: boolean }} opts
 * @returns {Promise<InitResult>}
 */
async function updatePackageJson(file, { addVitest, hooks }) {
  const pkg = (await readJson(file)) ?? {};
  const before = JSON.stringify(pkg);
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), '@oneup4real/standards': STANDARDS_DEPENDENCY };
  pkg.scripts = { ...(pkg.scripts ?? {}) };
  if (hooks) {
    pkg.devDependencies.husky ??= '^9.1.7';
    pkg.scripts.prepare ??= 'husky';
  }
  if (addVitest) {
    pkg.devDependencies.vitest ??= '^4.1.0';
    pkg.devDependencies['@vitest/coverage-v8'] ??= '^4.1.0';
    pkg.scripts.test ??= 'vitest run';
  }
  pkg.scripts.lint ??= 'eslint .';
  pkg.scripts['check:arch'] ??= 'depcruise src --config .dependency-cruiser.cjs';
  if (JSON.stringify(pkg) === before) return { file, action: 'unchanged' };
  await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return { file, action: 'updated' };
}

/**
 * @param {string} file
 * @returns {Promise<InitResult>}
 */
async function updateGitignore(file) {
  const existing = await fs.readFile(file, 'utf8').catch(() => null);
  const lines = new Set((existing ?? '').split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_PATTERNS.filter((p) => !lines.has(p));
  if (missing.length === 0) return { file, action: 'unchanged' };
  const prefix = existing === null ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
  const block = `\n# Added by @oneup4real/standards: never commit secrets or documents\n${missing.join('\n')}\n`;
  await fs.writeFile(file, prefix + block);
  return { file, action: existing === null ? 'created' : 'updated' };
}

/** @param {string} file */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Records current architecture violations so only new ones fail.
 * @param {{ targetDir: string, exec: (cmd: string, args: string[]) => Promise<{ code: number }> }} opts
 * @returns {Promise<number>}
 */
export async function writeBaseline({ targetDir, exec }) {
  const hasSrc = await fs.access(path.join(targetDir, 'src')).then(() => true, () => false);
  if (!hasSrc) return 0;
  const result = await exec('npx', [
    'depcruise', 'src', '--config', '.dependency-cruiser.cjs',
    '--output-type', 'baseline', '--output-to', '.dependency-cruiser-known-violations.json',
  ]);
  return result.code;
}
