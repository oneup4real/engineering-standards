// Inspects a directory to tailor the setup wizard: framework, Firebase, GitHub remote, existing config files.
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Template target → alternative file names that count as "already configured".
 * @type {Record<string, string[]>}
 */
export const CONFIG_ALTERNATIVES = {
  'eslint.config.mjs': ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js'],
  '.dependency-cruiser.cjs': ['.dependency-cruiser.cjs', '.dependency-cruiser.js', '.dependency-cruiser.json'],
  'vitest.config.ts': ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs'],
  '.github/workflows/ci.yml': ['.github/workflows/ci.yml', '.github/workflows/ci.yaml'],
  '.github/dependabot.yml': ['.github/dependabot.yml', '.github/dependabot.yaml'],
  '.husky/pre-commit': ['.husky/pre-commit'],
  '.husky/pre-push': ['.husky/pre-push'],
  '.lintstagedrc.json': ['.lintstagedrc.json', '.lintstagedrc', '.lintstagedrc.js', 'lint-staged.config.js'],
  '.standardsrc.json': ['.standardsrc.json'],
  '.github/pull_request_template.md': ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md'],
  'tests/arch/standards.test.ts': ['tests/arch/standards.test.ts'],
};

/**
 * @typedef {{
 *   isEmpty: boolean, name: string | null, framework: 'nextjs'|'node'|'unknown', usesFirebase: boolean,
 *   githubRemote: string | null, existing: string[], found: Record<string, string>, packageJson: Record<string, any> | null
 * }} ProjectInfo
 */

/**
 * @param {string} dir
 * @returns {Promise<ProjectInfo>}
 */
export async function detectProject(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  const packageJson = await readJson(path.join(dir, 'package.json'));
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };

  // `existing` lists template targets that are already covered; `found` maps each to the actual file name.
  /** @type {string[]} */
  const existing = [];
  /** @type {Record<string, string>} */
  const found = {};
  for (const [target, alternatives] of Object.entries(CONFIG_ALTERNATIVES)) {
    for (const alt of alternatives) {
      if (await exists(path.join(dir, alt))) {
        existing.push(target);
        found[target] = alt;
        break;
      }
    }
  }

  return {
    isEmpty: entries.filter((e) => e !== '.git' && e !== '.DS_Store').length === 0,
    name: packageJson?.name ?? null,
    framework: 'next' in deps ? 'nextjs' : packageJson ? 'node' : 'unknown',
    usesFirebase: 'firebase' in deps || 'firebase-admin' in deps,
    githubRemote: await readGithubRemote(dir),
    existing,
    found,
    packageJson,
  };
}

/** @param {string} dir */
async function readGithubRemote(dir) {
  const config = await fs.readFile(path.join(dir, '.git', 'config'), 'utf8').catch(() => '');
  const match = config.match(/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
  return match ? match[1] : null;
}

/** @param {string} file */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} file */
function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
