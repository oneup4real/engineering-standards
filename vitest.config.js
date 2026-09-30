import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['lib/**', 'arch/**', 'eslint/**', 'vitest/**', 'next/**', 'firebase-testing/**'],
      thresholds: { lines: 80 },
    },
  },
});
