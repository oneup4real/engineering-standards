// Architecture checks from @oneup4real/standards. Adjust the guard names and folders to this project.
// The two JSON files are ratchets: fix code instead of adding entries.
import path from 'node:path';
import { defineArchSuite } from '@oneup4real/standards/arch/suite';

defineArchSuite({
  root: path.resolve(import.meta.dirname, '../..'),
  serverOnly: { dir: 'src/server' },
  forbiddenImports: [
    {
      dirs: ['src/app', 'src/components', 'src/hooks', 'src/context'],
      exclude: ['src/app/actions/', 'src/app/api/'],
      patterns: ['^firebase-admin', '^@/server/', '^@/lib/firebase-admin'],
    },
  ],
  actionGuards: {
    actionsDir: 'src/app/actions',
    guardPattern: 'requireAuth|requireRole|requireStaff|requireSelfOrAdmin',
    gapsFile: 'arch-action-gaps.json',
  },
  writeRatchet: {
    dirs: ['src/app', 'src/components', 'src/hooks', 'src/context', 'src/lib'],
    exclude: ['src/app/actions/'],
    callPattern: 'addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction',
    allowlistFile: 'arch-allowlist.json',
  },
});
