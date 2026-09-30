// Rules that must fail the build rather than warn (they were warnings in projects that drifted).

/** @type {import('eslint').Linter.Config} */
export const strictness = {
  name: 'oneup4real/strictness',
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'prefer-const': 'error',
  },
};
