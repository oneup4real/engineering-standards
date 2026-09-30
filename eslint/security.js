// Security rules shared by every preset. Core ESLint rules only, so they work with any parser/plugin setup.

// Projects may use src/ or keep app/, components/ … at the root (create-next-app default).
const UI_FOLDERS = ['app', 'components', 'hooks', 'context'];
const UI_DIRS = UI_FOLDERS.flatMap((d) => [`src/${d}/**`, `${d}/**`]);
const TEST_FILES = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**', 'test/**'];
const ALL_SOURCE = ['src', ...UI_FOLDERS, 'lib', 'server', 'domain', 'shared'].map((d) => `${d}/**/*.{ts,tsx,js,jsx,mjs,cjs}`);

const seedDataPattern = {
  group: ['**/seed-data*', '**/seed_data*', '**/fixtures', '**/fixtures/**', '**/*.fixture*'],
  message: 'Seed/fixture data must not be imported into application code: it ships to every browser. Load it in scripts or tests only.',
};

const firestoreWrites = {
  name: 'firebase/firestore',
  importNames: ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'],
  message: 'UI code must not write to the database. Call a server action (src/server/actions) that validates, authorizes and audits the write.',
};

const restrictedSyntax = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML enables XSS. Render text normally or use an approved sanitizer wrapper.',
  },
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(SECRET|TOKEN|PRIVATE|PASSWORD)/]",
    message: 'NEXT_PUBLIC_* variables are visible to everyone. Secrets belong in server-only env vars or a secret manager.',
  },
];

/** @type {import('eslint').Linter.Config[]} */
export const securityRules = [
  {
    name: 'oneup4real/security/source',
    files: ALL_SOURCE,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { patterns: [seedDataPattern] }],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Later config wins per rule, so UI files repeat the seed-data pattern alongside the write ban.
    name: 'oneup4real/security/ui',
    files: UI_DIRS,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { paths: [firestoreWrites], patterns: [seedDataPattern] }],
    },
  },
];
