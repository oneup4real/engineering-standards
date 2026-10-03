// Consumer templates: reading, rendering and fingerprinting. Shared by `init` (writes them) and `doctor` (compares).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'consumer');

/** Line endings differ between platforms (git autocrlf); compare and hash with LF only. */
export function normalize(/** @type {string} */ text) {
  return text.replaceAll('\r\n', '\n');
}

/** @param {string} text */
export function hashContent(text) {
  return `sha256:${crypto.createHash('sha256').update(normalize(text)).digest('hex')}`;
}

/** @param {string} rel template path below templates/consumer */
export function template(rel) {
  return fs.readFile(path.join(TEMPLATE_DIR, rel), 'utf8');
}

export async function standardsVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, '..', '..', 'package.json'), 'utf8'));
  return /** @type {string} */ (pkg.version);
}

/**
 * The consumer ci.yml. "never" pins the exact release; otherwise the moving major tag delivers fixes automatically.
 * @param {{ updateMode?: string, codeScanning?: string, bundleCheck: boolean }} opts
 */
export async function renderCi({ updateMode = 'review', codeScanning = 'semgrep', bundleCheck }) {
  const ref = updateMode === 'never' ? `v${await standardsVersion()}` : 'v1';
  return (await template('.github/workflows/ci.yml'))
    .replaceAll('@v1', `@${ref}`)
    .replace('{{CODEQL}}', String(codeScanning === 'codeql'))
    .replace('{{SEMGREP}}', String(codeScanning === 'semgrep'))
    .replace('{{BUNDLE_CHECK}}', String(bundleCheck));
}

/**
 * ESLint entry file: the plain shared config, or the variant that merges a kept local config.
 * @param {string | null} localName e.g. eslint.config.local.mjs
 */
export async function renderEslint(localName) {
  if (!localName) return template('eslint.config.mjs');
  return (await template('eslint.config.merge.mjs')).replace('./eslint.config.local.mjs', `./${localName}`);
}

/** Which scanner a ci.yml written by the wizard enables (for projects set up before it was recorded). */
export function inferCodeScanning(/** @type {string | null} */ ciText) {
  if (ciText && /^\s*codeql:\s*true\s*$/m.test(ciText)) return 'codeql';
  return 'semgrep';
}

/**
 * @typedef {{ rel: string, content: string }} ManagedTemplate
 * @typedef {import('./config.js').StandardsConfig} StandardsConfig
 */

/**
 * Whole-file templates this project should contain, rendered for its settings.
 * Files the project replaced with an alternative (e.g. lint-staged.config.js) are left out.
 * @param {string} targetDir
 * @param {StandardsConfig} config
 * @returns {Promise<ManagedTemplate[]>}
 */
export async function managedTemplates(targetDir, config) {
  const at = (/** @type {string} */ rel) => path.join(targetDir, rel);
  const readOrNull = (/** @type {string} */ rel) => fs.readFile(at(rel), 'utf8').catch(() => null);
  const exists = (/** @type {string} */ rel) => fs.access(at(rel)).then(() => true, () => false);
  const anyExists = async (/** @type {string[]} */ rels) => (await Promise.all(rels.map(exists))).some(Boolean);

  /** @type {ManagedTemplate[]} */
  const list = [];
  const ciText = await readOrNull('.github/workflows/ci.yml');
  list.push({
    rel: '.github/workflows/ci.yml',
    content: await renderCi({
      updateMode: config.updateMode,
      codeScanning: config.codeScanning ?? inferCodeScanning(ciText),
      bundleCheck: (config.bundleForbiddenMarkers ?? []).length > 0,
    }),
  });

  if (!(await anyExists(['docs/pull_request_template.md'])) || (await exists('.github/pull_request_template.md'))) {
    list.push({ rel: '.github/pull_request_template.md', content: await template('.github/pull_request_template.md') });
  }

  if (!(await anyExists(['.dependency-cruiser.js', '.dependency-cruiser.json']))) {
    list.push({ rel: '.dependency-cruiser.cjs', content: await template('.dependency-cruiser.cjs') });
  }

  const eslintText = await readOrNull('eslint.config.mjs');
  const otherEslint = await anyExists(['eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js']);
  if (eslintText !== null || !otherEslint) {
    const local = eslintText?.match(/from '\.\/(eslint\.config\.local\.[cm]?[jt]s)'/)?.[1] ?? null;
    list.push({ rel: 'eslint.config.mjs', content: await renderEslint(local) });
  }

  if ((await exists('.husky')) && !(await anyExists(['.lintstagedrc', '.lintstagedrc.js', 'lint-staged.config.js']))) {
    list.push({ rel: '.lintstagedrc.json', content: await template('.lintstagedrc.json') });
  }

  if (config.updateMode === 'auto') {
    list.push({ rel: '.github/workflows/standards-automerge.yml', content: await template('.github/workflows/standards-automerge.yml') });
  }
  return list;
}

/**
 * Hashes of the managed files that currently equal their template. Recorded so a later upgrade can tell
 * "never touched" (safe to replace) from "edited by the project" (leave alone).
 * @param {string} targetDir
 * @param {StandardsConfig} config
 * @returns {Promise<Record<string, string>>}
 */
export async function currentTemplateHashes(targetDir, config) {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const { rel, content } of await managedTemplates(targetDir, config)) {
    const actual = await fs.readFile(path.join(targetDir, rel), 'utf8').catch(() => null);
    if (actual !== null && normalize(actual) === normalize(content)) hashes[rel] = hashContent(content);
  }
  return hashes;
}
