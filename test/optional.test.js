import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { OPTIONAL_FEATURES, addOptional } from '../lib/optional.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { tempDir, makeIo } from './helpers.js';

const OPT = 'templates/optional';
const exists = (p) => fs.access(p).then(() => true, () => false);

describe('optional templates', () => {
  it('offers sast, sca, mutation and dast', () => {
    expect(Object.keys(OPTIONAL_FEATURES).sort()).toEqual(['dast', 'mutation', 'sast', 'sca']);
  });

  it('copies the files of a feature into the project and never overwrites them', async () => {
    const dir = await tempDir();
    const first = await addOptional({ targetDir: dir, names: ['sast'] });
    expect(first.map((r) => r.action)).toEqual(['created', 'created']);
    expect(await exists(path.join(dir, '.semgrep/standards.yml'))).toBe(true);
    expect(await exists(path.join(dir, '.github/workflows/standards-sast.yml'))).toBe(true);
    await fs.writeFile(path.join(dir, '.semgrep/standards.yml'), 'rules: []\n');
    const again = await addOptional({ targetDir: dir, names: ['sast'] });
    expect(again.map((r) => r.action)).toEqual(['skipped', 'unchanged']);
    expect(await fs.readFile(path.join(dir, '.semgrep/standards.yml'), 'utf8')).toBe('rules: []\n');
  });

  it('--force replaces and keeps a .bak copy; --dry-run writes nothing', async () => {
    const dir = await tempDir();
    await addOptional({ targetDir: dir, names: ['mutation'] });
    await fs.writeFile(path.join(dir, 'stryker.config.mjs'), '// mine\n');
    const dry = await addOptional({ targetDir: dir, names: ['mutation'], force: true, dryRun: true });
    expect(dry[0].action).toBe('overwritten');
    expect(await fs.readFile(path.join(dir, 'stryker.config.mjs'), 'utf8')).toBe('// mine\n');
    await addOptional({ targetDir: dir, names: ['mutation'], force: true });
    expect(await fs.readFile(path.join(dir, 'stryker.config.mjs.bak'), 'utf8')).toBe('// mine\n');
  });

  it('rejects unknown feature names', async () => {
    await expect(addOptional({ targetDir: await tempDir(), names: ['nope'] })).rejects.toThrow(/Unknown optional feature/);
  });

  it('CLI: add lists features without arguments, "all" adds every feature', async () => {
    const dir = await tempDir();
    const none = makeIo(dir);
    expect(await runCli(['add'], none)).toBe(2);
    expect(none.err).toMatch(/sast.*sca.*mutation.*dast|Usage/s);
    const io = makeIo(dir);
    expect(await runCli(['add', 'all'], io)).toBe(0);
    for (const f of ['.semgrep/standards.yml', '.github/workflows/standards-sca.yml', 'stryker.config.mjs', '.github/workflows/standards-dast.yml']) {
      expect(await exists(path.join(dir, f)), f).toBe(true);
    }
    expect(await runCli(['add', 'bogus'], makeIo(dir))).toBe(2);
  });

  it('init --with adds the chosen features and nothing else', async () => {
    const { parseWith } = await import('../lib/optional.js');
    expect(parseWith(['--yes', '--with', 'sast,sca'])).toEqual(['sast', 'sca']);
    expect(parseWith(['--yes'])).toEqual([]);
  });
});

describe('workflow templates', () => {
  const files = ['standards-sast', 'standards-sca', 'standards-mutation', 'standards-dast'];
  it('parse, pin third-party actions to SHAs, are opt-in (no default blocking) and read only', async () => {
    for (const name of files) {
      const text = await fs.readFile(`${OPT}/.github/workflows/${name}.yml`, 'utf8');
      const wf = parse(text);
      expect(wf.permissions, name).toEqual({ contents: 'read' });
      for (const [, ref] of text.matchAll(/uses:\s*[\w.-]+\/[\w./-]+@(\S+)/g)) expect(ref, name).toMatch(/^[0-9a-f]{40}$/);
      expect(text, name).not.toMatch(/\$\{\{\s*github\.(event|head_ref)/); // no script injection from PR data
    }
  });

  it('dast never runs on pull requests and skips without a target', async () => {
    const text = await fs.readFile(`${OPT}/.github/workflows/standards-dast.yml`, 'utf8');
    const wf = parse(text);
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(text).toMatch(/DAST_TARGET_URL is not set; skipped/);
  });

  it('mutation and sast report only until a repository variable switches blocking on', async () => {
    expect(await fs.readFile(`${OPT}/.github/workflows/standards-sast.yml`, 'utf8')).toMatch(/STANDARDS_SAST_BLOCKING/);
    expect(await fs.readFile(`${OPT}/.github/workflows/standards-mutation.yml`, 'utf8')).toMatch(/STANDARDS_MUTATION_BREAK/);
    expect(await fs.readFile(`${OPT}/.github/workflows/standards-sca.yml`, 'utf8')).toMatch(/STANDARDS_SCA_BLOCKING/);
  });
});

describe('stryker.config.mjs', () => {
  it('mutates only the files in STRYKER_MUTATE and does not break the build by default', async () => {
    const url = new URL(`../${OPT}/stryker.config.mjs`, import.meta.url).href;
    const saved = { ...process.env };
    delete process.env.STRYKER_MUTATE;
    delete process.env.STRYKER_BREAK;
    const base = (await import(`${url}?a`)).default;
    expect(base.thresholds.break).toBeNull();
    expect(base.mutate).toContain('src/**/*.ts');
    process.env.STRYKER_MUTATE = 'src/lib/a.ts, src/lib/b.ts';
    process.env.STRYKER_BREAK = '50';
    const cfg = (await import(`${url}?b`)).default;
    Object.assign(process.env, saved);
    expect(cfg.mutate).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
    expect(cfg.thresholds.break).toBe(50);
  });
});

describe('semgrep ruleset', () => {
  it('is well-formed and every rule has a flagged and a clean fixture', async () => {
    const rules = parse(await fs.readFile(`${OPT}/semgrep/standards.yml`, 'utf8')).rules;
    const fixture = await fs.readFile(`${OPT}/semgrep/standards.tsx`, 'utf8');
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'standards.server-action-missing-auth-guard', 'standards.react-dangerously-set-inner-html', 'standards.unsanitized-html-sink',
      'standards.insecure-random-for-secret', 'standards.server-action-error-message-passthrough',
    ]));
    for (const rule of rules) {
      expect(rule.message?.length, rule.id).toBeGreaterThan(20);
      expect(['ERROR', 'WARNING', 'INFO'], rule.id).toContain(rule.severity);
      expect(rule.languages, rule.id).toContain('typescript');
      expect(rule.patterns ?? rule.pattern, rule.id).toBeTruthy();
      expect(fixture, rule.id).toContain(`// ruleid: ${rule.id}`);
      expect(fixture, rule.id).toContain(`// ok: ${rule.id}`);
    }
  });

  let semgrep = false;
  try { execFileSync('semgrep', ['--version'], { stdio: 'ignore' }); semgrep = true; } catch { /* not installed: rules stay unverified */ }
  it.skipIf(!semgrep)('passes semgrep --test against its fixtures', () => {
    execFileSync('semgrep', ['--test', '--config', `${OPT}/semgrep`, `${OPT}/semgrep`], { stdio: 'pipe' });
  });
});
