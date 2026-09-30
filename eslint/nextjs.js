// Next.js preset: eslint-config-next (from the consuming project) + security rules + strictness.
import base from './base.js';
import { securityRules } from './security.js';
import { strictness } from './strictness.js';

/** @param {unknown} error */
export function isModuleNotFound(error) {
  const { code, message = '' } = /** @type {{ code?: string, message?: string }} */ (error ?? {});
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  // Bundler-style resolvers (e.g. Vite) report a missing package without a Node error code.
  return /(Could not resolve|Cannot find (module|package)) ["']eslint-config-next/.test(message);
}

/**
 * @param {{ vitals: unknown, ts: unknown }} loaded default exports of eslint-config-next/core-web-vitals and /typescript
 * @returns {import('eslint').Linter.Config[]}
 */
export function composeNextConfig({ vitals, ts }) {
  if (!Array.isArray(vitals) || !Array.isArray(ts)) {
    throw new Error('[@oneup4real/standards] eslint-config-next 16 or newer is required (flat config arrays). Upgrade eslint-config-next, or use @oneup4real/standards/eslint/base.');
  }
  return [...vitals, ...ts];
}

async function loadNextConfigs() {
  try {
    const [vitals, ts] = await Promise.all([
      import('eslint-config-next/core-web-vitals'),
      import('eslint-config-next/typescript'),
    ]);
    return composeNextConfig({ vitals: vitals.default, ts: ts.default });
  } catch (error) {
    if (!isModuleNotFound(error)) throw error;
    console.warn('[@oneup4real/standards] eslint-config-next is not installed; falling back to the base preset.');
    return null;
  }
}

const nextConfigs = await loadNextConfigs();

/** @type {import('eslint').Linter.Config[]} */
export default nextConfigs === null
  ? base
  : [
      { ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts'] },
      ...nextConfigs,
      ...securityRules,
      strictness,
    ];

export { securityRules };
