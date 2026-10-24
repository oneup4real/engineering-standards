// Classifies a set of changed paths into a risk tier (T0..T3) and names the reviewers to run.
// Used by the orchestrator and CI to decide the review fan-out (skill `factory-review`, gate G0).
// The highest tier of any file wins. Globs can be replaced per tier in `.standardsrc.json` under "riskTiers".

/**
 * @typedef {'T0'|'T1'|'T2'|'T3'} Tier
 * @typedef {{ T3?: string[], T2?: string[], T1?: string[], T0?: string[], keywords?: string[] }} RiskTierConfig
 * @typedef {{ path: string, tier: Tier, reason: string }} FileTier
 * @typedef {{ tier: Tier, reviewers: string[], humanApproval: boolean, files: FileTier[] }} Classification
 */

export const DEFAULT_RISK_TIERS = Object.freeze({
  T3: [
    'src/app/actions/**', 'src/server/**', 'firestore.rules', 'storage.rules', '**/*.rules',
    '**/auth*', '**/auth*/**', '**/emails/**', '**/email-templates/**', '**/*email*template*', '**/templates/email*/**',
  ],
  T2: ['src/lib/**', 'src/domain/**', 'src/shared/**', 'src/hooks/**', 'src/context/**'],
  T1: ['src/components/**', '**/*.css', '**/*.scss', 'src/styles/**'],
  T0: [
    'docs/**', '**/*.md', 'tests/**', 'test/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*',
    '*.json', '*.config.*', '.*', '.github/**', '.husky/**',
  ],
  keywords: ['money', 'payment', 'billing', 'invoice', 'price', 'pricing', 'fee', 'role', 'permission', 'credential', 'secret', 'token', 'checkout', 'refund', 'payout'],
});

const TEST_GLOBS = ['tests/**', 'test/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*'];
const DOC_GLOBS = ['docs/**', '**/*.md'];
const GUARD_WORDS = ['rules', 'guard', 'actions', 'auth', 'permission'];
const ARCH_GLOBS = ['src/app/actions/**', 'src/server/**', 'src/domain/**', '.dependency-cruiser*', 'depcruise/**'];
const REVIEWER_ORDER = ['security', 'ui', 'logic', 'arch', 'test-quality'];

/** @param {string} glob */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** @param {string[]} globs */
const matcher = (globs) => {
  const list = globs.map((g) => ({ glob: g, re: globToRegExp(g) }));
  return (/** @type {string} */ p) => list.find((x) => x.re.test(p))?.glob ?? null;
};

/** Keyword as a whole word or camelCase part: `payment-status`, `RoleSwitcher`, `fee.ts` match; `feed`, `tokenizer` do not. @param {string[]} words */
function keywordRegExp(words) {
  if (words.length === 0) return null;
  const alt = words.map((w) => `${w}|${w[0].toUpperCase()}${w.slice(1)}`).join('|');
  return new RegExp(`(?<![A-Za-z])(?:${alt})s?(?![a-z])`);
}

/**
 * @param {string[]} paths repo-relative, forward slashes
 * @param {{ riskTiers?: RiskTierConfig }} [config]
 * @returns {Classification}
 */
export function classifyPaths(paths, config = {}) {
  const cfg = { ...DEFAULT_RISK_TIERS, ...(config.riskTiers ?? {}) };
  const isTest = matcher(TEST_GLOBS);
  const isDoc = matcher(DOC_GLOBS);
  const t3 = matcher(cfg.T3);
  const t2 = matcher(cfg.T2);
  const t1 = matcher(cfg.T1);
  const t0 = matcher(cfg.T0);
  const keyword = keywordRegExp(cfg.keywords);
  const isArch = matcher(ARCH_GLOBS);
  const guardTest = keywordRegExp([...cfg.keywords, ...GUARD_WORDS]);

  /** @type {FileTier[]} */
  const files = [];
  const wanted = new Set();
  let uiChanged = false;
  let archChanged = false;
  let guardTestChanged = false;
  for (const raw of paths) {
    const p = raw.replaceAll('\\', '/');
    /** @type {Tier} */
    let tier;
    let reason;
    let hit;
    if ((hit = isDoc(p) ?? isTest(p))) {
      tier = 'T0';
      reason = `docs/tests (${hit})`;
      if (isTest(p) && guardTest?.test(p)) guardTestChanged = true;
    } else if ((hit = t3(p))) { tier = 'T3'; reason = `T3 path (${hit})`; }
    else if ((hit = keyword?.exec(p)?.[0])) { tier = 'T3'; reason = `keyword in path (${hit})`; }
    else if ((hit = t2(p))) { tier = 'T2'; reason = `T2 path (${hit})`; }
    else if ((hit = t1(p))) { tier = 'T1'; reason = `T1 path (${hit})`; }
    else if ((hit = t0(p))) { tier = 'T0'; reason = `config (${hit})`; }
    else { tier = 'T2'; reason = 'unknown path, treated as T2 (when unsure take the higher tier)'; }
    files.push({ path: p, tier, reason });
    if (tier !== 'T0' && (tier === 'T1' || t1(p))) uiChanged = true;
    if (tier !== 'T0' && isArch(p)) archChanged = true;
  }

  const order = ['T0', 'T1', 'T2', 'T3'];
  const tier = /** @type {Tier} */ (files.reduce((max, f) => (order.indexOf(f.tier) > order.indexOf(max) ? f.tier : max), 'T0'));
  // T3: security, logic, test-quality always. T2: logic. T1: ui. T0: none. ui and architecture join by path.
  if (tier === 'T3') ['security', 'logic', 'test-quality'].forEach((r) => wanted.add(r));
  if (tier === 'T2') wanted.add('logic');
  if (tier !== 'T0') {
    if (uiChanged) wanted.add('ui');
    if (archChanged) wanted.add('arch');
    if (guardTestChanged) wanted.add('test-quality');
  }
  const reviewers = REVIEWER_ORDER.filter((r) => wanted.has(r));
  return { tier, reviewers, humanApproval: tier === 'T3', files };
}
