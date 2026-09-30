// Layered architecture rules: presentation → boundary → services → adapters; domain stays pure.
// Consumers spread `forbidden` into their own config and may add stricter rules.

// src/ layout or root layout (create-next-app without src/).
const PRESENTATION = '^(src/)?(app|components|hooks|context)/';

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const forbidden = [
  {
    name: 'no-presentation-to-adapters',
    comment: 'UI must not reach database/HTTP adapters directly. Go through a server action and a service.',
    severity: 'error',
    from: { path: PRESENTATION, pathNot: '^(src/)?app/(actions|api)/' },
    to: { path: '^(src/)?server/adapters/' },
  },
  {
    name: 'no-presentation-to-services',
    comment: 'UI must not import server services. Call a server action instead.',
    severity: 'error',
    from: { path: PRESENTATION, pathNot: '^(src/)?app/(actions|api)/' },
    to: { path: '^(src/)?server/services/' },
  },
  {
    name: 'domain-is-pure',
    comment: 'src/domain may only import src/domain and src/shared (no framework, DB or UI code).',
    severity: 'error',
    from: { path: '^(src/)?domain/' },
    to: { pathNot: ['^(src/)?(domain|shared)/', '^node_modules/zod/'], dependencyTypesNot: ['type-only'] },
  },
  {
    name: 'no-circular',
    comment: 'Circular dependencies make layers impossible to reason about.',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
  {
    name: 'not-to-unresolvable',
    comment: 'Imports must resolve (typo or missing dependency).',
    severity: 'error',
    from: {},
    to: { couldNotResolve: true },
  },
];

/** @type {import('dependency-cruiser').ICruiseOptions} */
const options = {
  doNotFollow: { path: 'node_modules' },
  exclude: { path: ['\\.test\\.', '\\.spec\\.', '__tests__'] },
  tsPreCompilationDeps: true,
  enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] },
};

module.exports = { forbidden, options };
