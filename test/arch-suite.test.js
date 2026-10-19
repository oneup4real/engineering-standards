import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { defineArchSuite, resolveStyleRatchet } from '../arch/suite.js';
import { tempDir } from './helpers.js';

// A clean project: every registered check must pass.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oneup-suite-'));
fs.mkdirSync(path.join(root, 'src/server'), { recursive: true });
fs.mkdirSync(path.join(root, 'src/app/actions'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/server/s.ts'), "import 'server-only';\n");
fs.writeFileSync(path.join(root, 'src/app/actions/a.ts'), "'use server';\nexport async function x() {\n  await requireAuth();\n}\n");

defineArchSuite({
  root,
  forbiddenImports: [{ dirs: ['src/app'], exclude: ['src/app/actions/'], patterns: ['^firebase-admin'] }],
  actionGuards: { guardPattern: 'requireAuth' },
  writeRatchet: { dirs: ['src/app'], exclude: ['src/app/actions/'], callPattern: 'setDoc', allowlistFile: 'allow.json' },
  setsInSync: [{ name: 'roles', sources: () => [{ label: 'a', values: ['x'] }, { label: 'b', values: ['x'] }] }],
});

it('styleRatchet without config explains what to add', async () => {
  const dir = await tempDir();
  expect(() => resolveStyleRatchet(dir)).toThrow(/uiStyleRatchet.*\.standardsrc\.json/);
});

it('styleRatchet reads uiStyleRatchet from .standardsrc.json', async () => {
  const dir = await tempDir();
  const cfg = { dirs: ['src'], exclude: ['src/components/ui/'], allowlistFile: 'ui-style-baseline.json' };
  fs.writeFileSync(path.join(dir, '.standardsrc.json'), JSON.stringify({ uiStyleRatchet: cfg }));
  expect(resolveStyleRatchet(dir)).toEqual(cfg);
});

it('styleRatchet wraps a malformed .standardsrc.json in a readable error', async () => {
  const dir = await tempDir();
  fs.writeFileSync(path.join(dir, '.standardsrc.json'), '{ nope');
  expect(() => resolveStyleRatchet(dir)).toThrow(/Could not parse \.standardsrc\.json: /);
});
