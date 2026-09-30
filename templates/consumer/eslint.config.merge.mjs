// Shared lint rules from @oneup4real/standards, combined with this project's previous config
// (kept in eslint.config.local.mjs). The shared rules come last so they win on conflicts.
import standards from '@oneup4real/standards/eslint/nextjs';
import local from './eslint.config.local.mjs';

export default [...(Array.isArray(local) ? local : [local]), ...standards];
