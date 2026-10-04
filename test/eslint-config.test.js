import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { securityRules } from '../eslint/security.js';
import base from '../eslint/base.js';

const parserLayer = {
  files: ['**/*.{ts,tsx,js,jsx}'],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
};

async function lint(code, filePath, config = [parserLayer, ...securityRules]) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config, cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
}

describe('security rules', () => {
  it('blocks firestore writes in src/app', async () => {
    expect(await lint("import { setDoc } from 'firebase/firestore';\nsetDoc();", 'src/app/page.tsx')).toContain('no-restricted-imports');
  });

  it('blocks firestore writes in src/hooks and src/context', async () => {
    for (const file of ['src/hooks/useX.ts', 'src/context/Auth.tsx']) {
      expect(await lint("import { writeBatch } from 'firebase/firestore';", file)).toContain('no-restricted-imports');
    }
  });

  it('allows firestore reads in src/app', async () => {
    expect(await lint("import { getDocs } from 'firebase/firestore';\ngetDocs();", 'src/app/page.tsx')).toEqual([]);
  });

  it('allows firestore writes in src/server/adapters', async () => {
    expect(await lint("import { setDoc } from 'firebase/firestore';\nsetDoc();", 'src/server/adapters/db.ts')).toEqual([]);
  });

  it('blocks seed-data import in src', async () => {
    expect(await lint("import s from '@/lib/seed-data.json';\ns;", 'src/lib/x.ts')).toContain('no-restricted-imports');
    expect(await lint("import s from '@/lib/seed-data.json';\ns;", 'src/app/page.tsx')).toContain('no-restricted-imports');
  });

  it('allows seed-data import in tests', async () => {
    expect(await lint("import s from '@/lib/seed-data.json';\ns;", 'src/lib/x.test.ts')).toEqual([]);
  });

  it('blocks dangerouslySetInnerHTML', async () => {
    expect(await lint('export const A = () => <div dangerouslySetInnerHTML={{ __html: x }} />;', 'src/components/A.tsx')).toContain('no-restricted-syntax');
  });

  it('blocks NEXT_PUBLIC secret names but allows public config', async () => {
    expect(await lint('const t = process.env.NEXT_PUBLIC_API_TOKEN;\nt;', 'src/lib/c.ts')).toContain('no-restricted-syntax');
    expect(await lint('const k = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;\nk;', 'src/lib/c.ts')).toEqual([]);
  });
});

describe('base config', () => {
  it('no-explicit-any is error', async () => {
    expect(await lint('export const a: any = 1;', 'src/lib/a.ts', base)).toContain('@typescript-eslint/no-explicit-any');
  });

  it('ignores .agents/**', () => {
    const ignoreConfig = base.find((c) => c.ignores);
    expect(ignoreConfig.ignores).toContain('.agents/**');
  });
});

describe('nextjs preset', () => {
  it('falls back to base when eslint-config-next is missing and still reports any', async () => {
    const { default: nextjs } = await import('../eslint/nextjs.js');
    expect(await lint('export const a: any = 1;', 'src/lib/a.ts', nextjs)).toContain('@typescript-eslint/no-explicit-any');
  });
});
