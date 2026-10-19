// Registers the architecture checks as Vitest tests. Use it in tests/arch/standards.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { checkServerOnly, checkForbiddenImports, checkActionGuards, checkCallRatchet, checkSetsInSync, checkStyleRatchet } from './index.js';

/**
 * @typedef {{
 *   root: string,
 *   serverOnly?: false | { dir?: string },
 *   forbiddenImports?: false | { dirs: string[], exclude?: string[], patterns: string[] }[],
 *   actionGuards?: false | { actionsDir?: string, guardPattern: string, publicMarker?: string, gapsFile?: string },
 *   writeRatchet?: false | { dirs: string[], exclude?: string[], callPattern: string, allowlistFile: string },
 *   styleRatchet?: boolean,
 *   setsInSync?: { name: string, sources: () => { label: string, values: string[] }[] }[],
 * }} ArchSuiteConfig
 */

/**
 * Reads `uiStyleRatchet` from <root>/.standardsrc.json (single source for suite and `baseline`).
 * @param {string} root
 * @returns {{ dirs: string[], exclude?: string[], allowlistFile: string }}
 */
export function resolveStyleRatchet(root) {
  const file = path.join(root, '.standardsrc.json');
  let cfg;
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8')).uiStyleRatchet;
    } catch (err) {
      throw new Error(`Could not parse .standardsrc.json: ${/** @type {Error} */ (err).message}`, { cause: err });
    }
  }
  if (!cfg?.dirs?.length || !cfg.allowlistFile) {
    throw new Error('styleRatchet is on but "uiStyleRatchet": { "dirs": [...], "allowlistFile": "..." } is missing in .standardsrc.json');
  }
  return cfg;
}

/** @param {import('./index.js').Violation[]} violations */
const format = (violations) => violations.map((v) => `  ${v.file}${v.line ? `:${v.line}` : ''} → ${v.message}`).join('\n');

/** @param {ArchSuiteConfig} config */
export function defineArchSuite(config) {
  const { root } = config;
  describe('architecture (oneup4real/engineering-standards)', () => {
    if (config.serverOnly !== false) {
      it('every src/server file imports server-only', () => {
        const v = checkServerOnly({ root, ...(config.serverOnly ?? {}) });
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
    for (const [i, rule] of (config.forbiddenImports || []).entries()) {
      it(`forbidden imports #${i + 1} (${rule.patterns.join(', ')})`, () => {
        const v = checkForbiddenImports({ root, ...rule });
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
    if (config.actionGuards) {
      const opts = config.actionGuards;
      it('every exported server action is guarded or marked @public-action', () => {
        const v = checkActionGuards({ root, ...opts });
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
    if (config.writeRatchet) {
      const opts = config.writeRatchet;
      it('direct database writes outside server code only decrease', () => {
        const v = checkCallRatchet({ root, ...opts });
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
    if (config.styleRatchet) {
      it('arbitrary style values outside UI primitives only decrease', () => {
        const v = checkStyleRatchet({ root, ...resolveStyleRatchet(root) });
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
    for (const sync of config.setsInSync ?? []) {
      it(`${sync.name} stay in sync`, () => {
        const v = checkSetsInSync(sync.sources());
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
  });
}
