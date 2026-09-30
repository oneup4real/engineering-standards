// Registers the architecture checks as Vitest tests. Use it in tests/arch/standards.test.ts.
import { describe, it, expect } from 'vitest';
import { checkServerOnly, checkForbiddenImports, checkActionGuards, checkCallRatchet, checkSetsInSync } from './index.js';

/**
 * @typedef {{
 *   root: string,
 *   serverOnly?: false | { dir?: string },
 *   forbiddenImports?: false | { dirs: string[], exclude?: string[], patterns: string[] }[],
 *   actionGuards?: false | { actionsDir?: string, guardPattern: string, publicMarker?: string, gapsFile?: string },
 *   writeRatchet?: false | { dirs: string[], exclude?: string[], callPattern: string, allowlistFile: string },
 *   setsInSync?: { name: string, sources: () => { label: string, values: string[] }[] }[],
 * }} ArchSuiteConfig
 */

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
    for (const sync of config.setsInSync ?? []) {
      it(`${sync.name} stay in sync`, () => {
        const v = checkSetsInSync(sync.sources());
        expect(v, `\n${format(v)}`).toEqual([]);
      });
    }
  });
}
