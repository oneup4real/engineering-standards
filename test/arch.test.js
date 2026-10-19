import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkServerOnly, checkForbiddenImports, checkActionGuards, checkCallRatchet, checkSetsInSync, countArbitraryStyles, checkStyleRatchet } from '../arch/index.js';
import { tempDir } from './helpers.js';

async function project(files) {
  const root = await tempDir();
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  }
  return root;
}

const GUARD = 'requireAuth|requireRole';

describe('checkServerOnly', () => {
  it('server-only missing is reported', async () => {
    const root = await project({ 'src/server/a.ts': "import 'server-only';\n", 'src/server/b.ts': 'export const b = 1;\n' });
    expect(checkServerOnly({ root }).map((v) => v.file)).toEqual(['src/server/b.ts']);
  });
});

describe('checkForbiddenImports', () => {
  it('admin sdk import in ui is reported with line', async () => {
    const root = await project({
      'src/components/A.tsx': "import x from 'react';\nimport { getAuth } from 'firebase-admin/auth';\n",
      'src/app/api/route.ts': "import admin from 'firebase-admin';\n",
    });
    const violations = checkForbiddenImports({ root, dirs: ['src/components', 'src/app'], exclude: ['src/app/api/'], patterns: ['firebase-admin'] });
    expect(violations).toEqual([expect.objectContaining({ file: 'src/components/A.tsx', line: 2 })]);
  });
});

describe('checkActionGuards', () => {
  const actions = (body) => ({ 'src/app/actions/a.ts': `'use server';\n${body}` });

  it('unguarded exported action is reported', async () => {
    const root = await project(actions('export async function del(id: string) {\n  return id;\n}\n'));
    expect(checkActionGuards({ root, guardPattern: GUARD })).toEqual([expect.objectContaining({ file: 'src/app/actions/a.ts', message: expect.stringContaining('del') })]);
  });

  it('arrow function with complex nested parameters is detected', async () => {
    const root = await project(actions('export const doSomething = async (options: { filter: () => boolean }): Promise<void> => {\n  await requireAuth();\n};\n'));
    expect(checkActionGuards({ root, guardPattern: GUARD })).toEqual([]);
  });

  it('guarded action passes', async () => {
    const root = await project(actions('export async function del(id: string) {\n  await requireAuth();\n  return id;\n}\n'));
    expect(checkActionGuards({ root, guardPattern: GUARD })).toEqual([]);
  });

  it('@public-action marker exempts action', async () => {
    const root = await project(actions('// @public-action: tenant report form, rate limited\nexport async function report() {\n  return 1;\n}\n'));
    expect(checkActionGuards({ root, guardPattern: GUARD })).toEqual([]);
  });

  it('guard call inside a nested string or comment does not count', async () => {
    const root = await project(actions("export async function sneaky() {\n  const s = 'requireAuth()';\n  // requireAuth()\n  return s;\n}\n"));
    expect(checkActionGuards({ root, guardPattern: GUARD })).toHaveLength(1);
  });

  it('documented gaps are allowed', async () => {
    const root = await project({ ...actions('export async function legacy() {\n  return 1;\n}\n'), 'gaps.json': JSON.stringify({ 'src/app/actions/a.ts': { legacy: 'ticket #12' } }) });
    expect(checkActionGuards({ root, guardPattern: GUARD, gapsFile: 'gaps.json' })).toEqual([]);
  });

  it('missing use server is reported', async () => {
    const root = await project({ 'src/app/actions/b.ts': 'export async function x() {\n  await requireAuth();\n}\n' });
    expect(checkActionGuards({ root, guardPattern: GUARD })).toEqual([expect.objectContaining({ message: expect.stringContaining("'use server'") })]);
  });
});

describe('checkCallRatchet', () => {
  const opts = (root) => ({ root, dirs: ['src/app'], exclude: ['src/app/actions/'], callPattern: 'setDoc|addDoc', allowlistFile: 'allow.json' });

  it('ratchet reports regression when count exceeds allowlist', async () => {
    const root = await project({ 'src/app/p.tsx': 'setDoc(a);\naddDoc(b);\n', 'allow.json': JSON.stringify({ 'src/app/p.tsx': 1 }) });
    expect(checkCallRatchet(opts(root))).toEqual([expect.objectContaining({ file: 'src/app/p.tsx', message: expect.stringContaining('2') })]);
  });

  it('ratchet reports stale entry when count drops below allowlist', async () => {
    const root = await project({ 'src/app/p.tsx': 'setDoc(a);\n', 'allow.json': JSON.stringify({ 'src/app/p.tsx': 3 }) });
    expect(checkCallRatchet(opts(root))).toEqual([expect.objectContaining({ message: expect.stringContaining('shrink') })]);
  });

  it('excluded dirs and missing allowlist file are handled', async () => {
    const root = await project({ 'src/app/actions/x.ts': 'setDoc(a);\n' });
    expect(checkCallRatchet(opts(root))).toEqual([]);
  });
});

describe('checkSetsInSync', () => {
  it('sets in sync reports missing and unknown per source', () => {
    const violations = checkSetsInSync([
      { label: 'code', values: ['admin', 'viewer'] },
      { label: 'docs', values: ['admin', 'auditor'] },
    ]);
    expect(violations.map((v) => v.message).join('\n')).toMatch(/docs.*missing.*viewer/);
    expect(violations.map((v) => v.message).join('\n')).toMatch(/docs.*unknown.*auditor/);
  });

  it('identical sets pass', () => {
    expect(checkSetsInSync([{ label: 'a', values: ['x', 'y'] }, { label: 'b', values: ['y', 'x'] }])).toEqual([]);
  });
});

describe('countArbitraryStyles', () => {
  it('counts arbitrary sizes, radii, spacing and hex colors including variant prefixes', async () => {
    const root = await project({
      'src/components/A.tsx': `<span className="text-[11px] md:text-[10.5px] hover:rounded-[18px] px-[13px] bg-[#0062e0]" />`,
      'src/components/B.tsx': `<span className="text-sm rounded-xl p-4 bg-primary text-[var(--x)] w-[200px]" />`,
      'src/components/ui/Pill.tsx': `<span className="text-[10px]" />`,
    });
    expect(countArbitraryStyles({ root, dirs: ['src'], exclude: ['src/components/ui/'] })).toEqual({ 'src/components/A.tsx': 5 });
  });
});

describe('checkStyleRatchet', () => {
  const files = { 'src/a.tsx': '"text-[11px] text-[12px]"', 'src/b.tsx': '"rounded-[9px]"' };

  it('passes when counts equal the baseline', async () => {
    const root = await project({ ...files, 'ui.json': JSON.stringify({ 'src/a.tsx': 2, 'src/b.tsx': 1 }) });
    expect(checkStyleRatchet({ root, dirs: ['src'], allowlistFile: 'ui.json' })).toEqual([]);
  });

  it('fails on an increase and on a new file', async () => {
    const root = await project({ ...files, 'ui.json': JSON.stringify({ 'src/a.tsx': 1 }) });
    const v = checkStyleRatchet({ root, dirs: ['src'], allowlistFile: 'ui.json' });
    expect(v.map((x) => x.file).sort()).toEqual(['src/a.tsx', 'src/b.tsx']);
    expect(v[0].message).toMatch(/design tokens|primitive/);
  });

  it('asks to shrink the baseline when counts went down', async () => {
    const root = await project({ ...files, 'ui.json': JSON.stringify({ 'src/a.tsx': 5, 'src/b.tsx': 1, 'src/gone.tsx': 2 }) });
    const v = checkStyleRatchet({ root, dirs: ['src'], allowlistFile: 'ui.json' });
    expect(v).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/a.tsx', message: expect.stringMatching(/shrink/) }),
      expect.objectContaining({ file: 'src/gone.tsx', message: expect.stringMatching(/delete its entry/) }),
    ]));
  });

  it('without a baseline file one violation names the baseline command', async () => {
    const root = await project(files);
    const v = checkStyleRatchet({ root, dirs: ['src'], allowlistFile: 'ui.json' });
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe('ui.json');
    expect(v[0].message).toMatch(/baseline file missing.*npx oneup-standards baseline/);
  });

  it('a missing baseline file with no arbitrary values passes', async () => {
    const root = await project({ 'src/a.tsx': '"text-sm"' });
    expect(checkStyleRatchet({ root, dirs: ['src'], allowlistFile: 'ui.json' })).toEqual([]);
  });
});
