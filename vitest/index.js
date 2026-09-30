// Vitest preset: shared defaults with coverage thresholds on the pure domain layer.

const DEFAULTS = {
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // Include every source file, so untested files show up as 0% instead of disappearing.
      include: ['src/**', 'app/**', 'lib/**'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/__tests__/**'],
      thresholds: {
        'src/domain/**': { lines: 90, functions: 90, branches: 80 },
      },
    },
  },
};

/**
 * @param {import('vitest/config').UserConfig} [overrides]
 * @returns {import('vitest/config').UserConfig}
 */
export function defineStandardsConfig(overrides = {}) {
  return deepMerge(structuredClone(DEFAULTS), overrides);
}

/**
 * Recursively merges plain objects; arrays and other values from `source` replace those in `target`.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    target[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return target;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
