// Opt-in security templates (mutation testing, DAST). SAST and SCA are part of the shared security.yml, not templates. Never installed by default:
// `oneup-standards add <name>` or `oneup-standards init --with <names>` copies them into a project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './templates.js';

const OPTIONAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'optional');

/** @type {Record<string, { summary: string, files: Record<string, string> }>} */
export const OPTIONAL_FEATURES = {
  mutation: {
    summary: 'Stryker config and a CI job that mutates only the files changed in the pull request (thresholds warn until STANDARDS_MUTATION_BREAK is set)',
    files: { 'stryker.config.mjs': 'stryker.config.mjs', '.github/workflows/standards-mutation.yml': '.github/workflows/standards-mutation.yml' },
  },
  dast: {
    summary: 'Nightly OWASP ZAP baseline scan against DAST_TARGET_URL (needs a deployed or seeded target; skips itself without one)',
    files: { '.github/workflows/standards-dast.yml': '.github/workflows/standards-dast.yml' },
  },
};

/**
 * @param {{ targetDir: string, names: string[], force?: boolean, dryRun?: boolean }} opts
 * @returns {Promise<{ file: string, action: 'created'|'unchanged'|'skipped'|'overwritten', note?: string }[]>}
 */
export async function addOptional({ targetDir, names, force = false, dryRun = false }) {
  const unknown = names.filter((n) => !(n in OPTIONAL_FEATURES));
  if (unknown.length > 0) throw new Error(`Unknown optional feature: ${unknown.join(', ')}. Available: ${Object.keys(OPTIONAL_FEATURES).join(', ')}`);
  const results = [];
  for (const name of names) {
    for (const [from, to] of Object.entries(OPTIONAL_FEATURES[name].files)) {
      const content = await fs.readFile(path.join(OPTIONAL_DIR, from), 'utf8');
      const dest = path.join(targetDir, to);
      const existing = await fs.readFile(dest, 'utf8').catch(() => null);
      if (existing !== null && normalize(existing) === normalize(content)) {
        results.push({ file: dest, action: 'unchanged' });
        continue;
      }
      if (existing !== null && !force) {
        results.push({ file: dest, action: 'skipped', note: 'exists and differs; use --force to replace (keeps a .bak copy)' });
        continue;
      }
      if (!dryRun) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        if (existing !== null) await fs.writeFile(`${dest}.bak`, existing);
        await fs.writeFile(dest, content);
      }
      results.push({ file: dest, action: existing === null ? 'created' : 'overwritten' });
    }
  }
  return results;
}

/** Feature names from `--with mutation,dast`; empty when the flag is absent. @param {string[]} args */
export function parseWith(args) {
  const i = args.indexOf('--with');
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) return [];
  return args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
}
