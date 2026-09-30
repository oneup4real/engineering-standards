import { describe, it, expect } from 'vitest';
import { defineStandardsConfig } from '../vitest/index.js';

describe('defineStandardsConfig', () => {
  it('defaults include domain thresholds', () => {
    const config = defineStandardsConfig();
    expect(config.test.coverage.provider).toBe('v8');
    expect(config.test.coverage.thresholds['src/domain/**']).toEqual({ lines: 90, functions: 90, branches: 80 });
    expect(config.test.include).toEqual(['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}']);
  });

  it('overrides merge without dropping defaults', () => {
    const config = defineStandardsConfig({ test: { coverage: { thresholds: { lines: 50 } } } });
    expect(config.test.coverage.thresholds.lines).toBe(50);
    expect(config.test.coverage.thresholds['src/domain/**']).toBeDefined();
    expect(config.test.coverage.provider).toBe('v8');
  });

  it('replaces arrays instead of concatenating', () => {
    const config = defineStandardsConfig({ test: { include: ['tests/**/*.test.ts'] } });
    expect(config.test.include).toEqual(['tests/**/*.test.ts']);
  });

  it('does not mutate defaults between calls', () => {
    defineStandardsConfig({ test: { coverage: { provider: 'istanbul' } } });
    expect(defineStandardsConfig().test.coverage.provider).toBe('v8');
  });
});
