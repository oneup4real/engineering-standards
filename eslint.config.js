// Lint config for this repository's own JavaScript.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'test/fixtures/**', 'templates/**', '.superpowers/**'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
];
