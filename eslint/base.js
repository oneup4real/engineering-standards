// Base preset for TypeScript projects without a framework preset.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { securityRules } from './security.js';
import { strictness } from './strictness.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '.next/**', 'out/**', '.agents/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...securityRules,
  strictness,
  {
    files: ['**/*.cjs', '**/*.cts'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
];

