// Opt-in Stryker config (npx oneup-standards add mutation).
// Needs: npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner
// CI sets STRYKER_MUTATE to the comma-separated source files changed in the pull request, so only those are mutated.
// Locally: STRYKER_MUTATE=src/lib/fee.ts npx stryker run
// Thresholds are warnings (break: null) until STRYKER_BREAK=<percent> is set (CI: repository variable STANDARDS_MUTATION_BREAK).
const mutate = process.env.STRYKER_MUTATE
  ? process.env.STRYKER_MUTATE.split(',').map((f) => f.trim()).filter(Boolean)
  : ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.{test,spec}.{ts,tsx}'];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate,
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 80, low: 60, break: process.env.STRYKER_BREAK ? Number(process.env.STRYKER_BREAK) : null },
};
