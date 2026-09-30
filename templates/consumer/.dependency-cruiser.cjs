// Architecture rules from @oneup4real/standards: UI → server actions → services → adapters; pure domain.
// Existing violations are listed in .dependency-cruiser-known-violations.json (only ever shrink it).
const fs = require('node:fs');
const { forbidden, options } = require('@oneup4real/standards/depcruise/layered');

module.exports = {
  forbidden,
  options: {
    ...options,
    ...(fs.existsSync('tsconfig.json') ? { tsConfig: { fileName: 'tsconfig.json' } } : {}),
  },
};
