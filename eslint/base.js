// Base preset for TypeScript projects without a framework preset.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { securityRules } from './security.js';
import { strictness } from './strictness.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '.next/**', 'out/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...securityRules,
  strictness,
];
