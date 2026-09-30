import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cruise } from 'dependency-cruiser';

const require = createRequire(import.meta.url);
const layered = require('../depcruise/layered.cjs');
const fixtureRoot = path.resolve('test/fixtures/layered');

async function violations() {
  const result = await cruise(['src'], {
    validate: true,
    ruleSet: { forbidden: layered.forbidden },
    ...layered.options,
    baseDir: fixtureRoot,
  });
  return result.output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
}

describe('layered dependency-cruiser rules', () => {
  it('flags app → server/adapters', async () => {
    expect(await violations()).toContainEqual({ rule: 'no-presentation-to-adapters', from: 'src/app/page.ts', to: 'src/server/adapters/db.ts' });
  });

  it('flags domain → app', async () => {
    expect(await violations()).toContainEqual({ rule: 'domain-is-pure', from: 'src/domain/rule.ts', to: 'src/app/page.ts' });
  });

  it('allows domain → shared', async () => {
    const fromOk = (await violations()).filter((v) => v.from === 'src/domain/ok.ts');
    expect(fromOk).toEqual([]);
  });

  it('exports the rule names from the spec', () => {
    expect(layered.forbidden.map((r) => r.name)).toEqual(
      expect.arrayContaining(['no-presentation-to-adapters', 'domain-is-pure', 'no-circular', 'not-to-unresolvable']),
    );
  });
});
