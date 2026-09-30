import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineArchSuite } from '../arch/suite.js';

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
