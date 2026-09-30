// Regression tests for the final-review findings (C = critical, I = important).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { createRequire } from 'node:module';
import { initProject, RECOMMENDED_ANSWERS } from '../lib/init.js';
import { checkCallRatchet, checkActionGuards } from '../arch/index.js';
import { defineStandardsConfig } from '../vitest/index.js';
import { securityRules } from '../eslint/security.js';
import { composeNextConfig, isModuleNotFound } from '../eslint/nextjs.js';
import { securityHeaders } from '../next/headers.js';
import { preCommit, prePush } from '../lib/hooks.js';
import { tempDir, makeIo } from './helpers.js';

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8');
async function repo(files = {}, pkg = { name: 'demo', dependencies: { next: '16' }, devDependencies: { vitest: '5' } }) {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  return dir;
}

describe('C1: eslint configs other than eslint.config.mjs', () => {
  it('merge works with eslint.config.js', async () => {
    const dir = await repo({ 'eslint.config.js': 'export default [];' });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, 'eslint.config.local.js'))).toBe('export default [];');
    expect(await read(path.join(dir, 'eslint.config.mjs'))).toContain("from './eslint.config.local.js'");
    expect(await exists(path.join(dir, 'eslint.config.js'))).toBe(false);
  });

  it('replace moves a non-mjs config out of the way (backup) so the shared config is the one ESLint loads', async () => {
    const dir = await repo({ 'eslint.config.js': 'old' });
    await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, eslint: 'replace' } });
    expect(await exists(path.join(dir, 'eslint.config.js'))).toBe(false);
    expect(await read(path.join(dir, 'eslint.config.js.bak'))).toBe('old');
  });

  it('legacy .eslintrc cannot be merged: backup + note, shared config created', async () => {
    const dir = await repo({ '.eslintrc.json': '{}' });
    const results = await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, '.eslintrc.json.bak'))).toBe('{}');
    expect(await exists(path.join(dir, 'eslint.config.mjs'))).toBe(true);
    expect(results.find((r) => r.file.endsWith('eslint.config.mjs')).note).toMatch(/legacy/);
  });
});

describe('C2: running init twice', () => {
  it('keeps the user config after a second merge run', async () => {
    const dir = await repo({ 'eslint.config.mjs': 'export default [{ rules: {} }];' });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    const results = await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, 'eslint.config.local.mjs'))).toBe('export default [{ rules: {} }];');
    expect(results.find((r) => r.file.endsWith('eslint.config.mjs')).action).toBe('unchanged');
  });
});

describe('C3: architecture suite is collected', () => {
  it('vitest preset includes tests/**', () => {
    expect(defineStandardsConfig().test.include).toContain('tests/**/*.test.{ts,tsx}');
  });

  it('non-vitest projects do not get an arch test they cannot run', async () => {
    const dir = await repo({}, { name: 'x', scripts: { test: 'node --test' } });
    const results = await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await exists(path.join(dir, 'tests/arch/standards.test.ts'))).toBe(false);
    expect(results.find((r) => r.file.endsWith('standards.test.ts')).note).toMatch(/vitest/i);
  });
});

describe('I4: string/regex stripping does not hide calls', () => {
  const ratchet = async (code) => {
    const dir = await repo({ 'src/app/p.tsx': code });
    return checkCallRatchet({ root: dir, dirs: ['src/app'], callPattern: 'setDoc', allowlistFile: 'none.json' });
  };
  it('apostrophe in JSX text', async () => {
    expect(await ratchet("const a = <p>You don't have access</p>;\nsetDoc(ref, data);\n")).toHaveLength(1);
  });
  it('quote inside a regex literal', async () => {
    expect(await ratchet("const r = s.replace(/'/g, '');\nsetDoc(ref, data);\n")).toHaveLength(1);
  });
  it('template literal interpolation is code', async () => {
    expect(await ratchet('const t = `a ${setDoc(ref, data)} b`;\n')).toHaveLength(1);
  });
  it('real strings still do not count', async () => {
    expect(await ratchet("const s = 'setDoc(x)';\n")).toEqual([]);
  });
});

describe('I5: all exported action forms are checked', () => {
  const guards = async (code) => {
    const dir = await repo({ 'src/app/actions/a.ts': `'use server';\n${code}` });
    return checkActionGuards({ root: dir, guardPattern: 'requireAuth' });
  };
  it('export const x = async function () {}', async () => {
    expect(await guards('export const x = async function () {\n  return 1;\n};\n')).toHaveLength(1);
  });
  it('export default async function', async () => {
    expect(await guards('export default async function () {\n  return 1;\n}\n')).toHaveLength(1);
  });
});

describe('I6: hooks never download packages', () => {
  it('templates and hook commands use npx --no-install', async () => {
    for (const hook of ['pre-commit', 'pre-push']) {
      expect(await read(`templates/consumer/.husky/${hook}`)).toContain('npx --no-install oneup-standards');
    }
    const calls = [];
    const deps = { stagedPaths: async () => [], which: async () => true, exec: async (c, a) => { calls.push([c, ...a].join(' ')); return { code: 0 }; } };
    await preCommit(makeIo(), deps);
    await prePush(makeIo(), deps);
    for (const c of calls.filter((x) => x.startsWith('npx'))) expect(c).toMatch(/^npx --no-install /);
  });
});

describe('I7: existing hooks, dependabot and ci.yml are preserved', () => {
  it('appends the standards hook to an existing husky hook once', async () => {
    const dir = await repo({ '.husky/pre-commit': 'npm test\n' });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    const hook = await read(path.join(dir, '.husky/pre-commit'));
    expect(hook.startsWith('npm test\n')).toBe(true);
    expect(hook.match(/oneup-standards hook pre-commit/g)).toHaveLength(1);
  });

  it('keeps an existing dependabot.yml', async () => {
    const dir = await repo({ '.github/dependabot.yml': 'mine' });
    const results = await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, '.github/dependabot.yml'))).toBe('mine');
    expect(results.find((r) => r.file.endsWith('dependabot.yml')).action).toBe('skipped');
  });

  it('replacing ci.yml keeps a backup', async () => {
    const dir = await repo({ '.github/workflows/ci.yml': 'old-ci' });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, '.github/workflows/ci.yml.bak'))).toBe('old-ci');
  });
});

describe('I8: eslint-config-next loading', () => {
  it('rejects a non-flat (Next 15) config shape with a clear error', () => {
    expect(() => composeNextConfig({ vitals: { extends: ['next'] }, ts: [] })).toThrow(/eslint-config-next 16/);
  });
  it('accepts flat arrays', () => {
    expect(composeNextConfig({ vitals: [{ name: 'a' }], ts: [{ name: 'b' }] })).toHaveLength(2);
  });
  it('only module-not-found counts as "not installed"', () => {
    expect(isModuleNotFound(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }))).toBe(true);
    expect(isModuleNotFound(new TypeError('vitals.default is not iterable'))).toBe(false);
    expect(isModuleNotFound(new Error('Could not resolve "eslint-config-next/typescript" imported by "x"'))).toBe(true);
    expect(isModuleNotFound(new Error("Cannot find package 'eslint-config-next' imported from /x"))).toBe(true);
  });
});

describe('I9: projects without src/', () => {
  const lint = async (code, filePath) => {
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } }, ...securityRules] });
    const [r] = await eslint.lintText(code, { filePath });
    return r.messages.map((m) => m.ruleId);
  };
  it('root app/ gets the firestore write ban', async () => {
    expect(await lint("import { setDoc } from 'firebase/firestore';\nsetDoc();", 'app/page.tsx')).toContain('no-restricted-imports');
  });
  it('root lib/ gets the seed-data ban', async () => {
    expect(await lint("import s from '../seed-data.json';\ns;", 'lib/x.ts')).toContain('no-restricted-imports');
  });
  it('depcruise presentation rule matches root app/', () => {
    const { forbidden } = createRequire(import.meta.url)('../depcruise/layered.cjs');
    const rule = forbidden.find((r) => r.name === 'no-presentation-to-services');
    expect(new RegExp(rule.from.path).test('app/page.tsx')).toBe(true);
  });
});

describe('I10: CSP for Firebase apps', () => {
  it('firebase option opens the Firebase endpoints', () => {
    const csp = securityHeaders({ firebase: true }).find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.googleapis\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.firebaseapp\.com/);
  });
});

describe('I12 + CI red after init', () => {
  it('"never" mode pins CI to the exact release, not the moving v1 tag', async () => {
    const dir = await repo();
    await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, updateMode: 'never' } });
    const ci = await read(path.join(dir, '.github/workflows/ci.yml'));
    expect(ci).toMatch(/ci-node\.yml@v\d+\.\d+\.\d+/);
    expect(ci).not.toMatch(/@v1\s*$/m);
  });

  it('bundle check is off until markers are configured, on when given', async () => {
    const off = await repo();
    await initProject({ targetDir: off, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(off, '.github/workflows/ci.yml'))).toContain('bundle-check: false');
    const on = await repo();
    await initProject({ targetDir: on, answers: { ...RECOMMENDED_ANSWERS, bundleMarkers: ['SECRET-ID-'] } });
    expect(await read(path.join(on, '.github/workflows/ci.yml'))).toContain('bundle-check: true');
    expect(JSON.parse(await read(path.join(on, '.standardsrc.json'))).bundleForbiddenMarkers).toEqual(['SECRET-ID-']);
  });
});
