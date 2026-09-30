import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initProject, RECOMMENDED_ANSWERS } from '../lib/init.js';
import { tempDir } from './helpers.js';

const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8');

async function newRepo(pkg = { name: 'demo', dependencies: { next: '16' } }) {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return dir;
}

describe('initProject', () => {
  it('creates all template files in empty repo', async () => {
    const dir = await newRepo();
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    for (const f of ['eslint.config.mjs', '.dependency-cruiser.cjs', 'vitest.config.ts', '.github/workflows/ci.yml',
      '.github/dependabot.yml', '.husky/pre-commit', '.husky/pre-push', '.standardsrc.json', '.lintstagedrc.json', 'AGENTS.md', 'CLAUDE.md',
      'tests/arch/standards.test.ts', 'arch-allowlist.json', 'arch-action-gaps.json']) {
      expect(await exists(path.join(dir, f)), f).toBe(true);
    }
  });

  it('adds the standards package, husky and scripts to package.json', async () => {
    const dir = await newRepo();
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    const pkg = JSON.parse(await read(path.join(dir, 'package.json')));
    expect(pkg.devDependencies['@oneup4real/standards']).toBe('github:oneup4real/engineering-standards#semver:^1.0.0');
    expect(pkg.devDependencies.husky).toBeDefined();
    expect(pkg.scripts.prepare).toBe('husky');
  });

  it('keeps an existing test script when vitest answer is keep or unprompted', async () => {
    const dir = await newRepo({ name: 'x', scripts: { test: 'node --test' } });
    const results = await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, vitest: 'keep' } });
    const pkg = JSON.parse(await read(path.join(dir, 'package.json')));
    expect(pkg.scripts.test).toBe('node --test');
    expect(results.find((r) => r.file.endsWith('vitest.config.ts')).action).toBe('skipped');
  });

  it('migrates an existing test script to vitest when vitest answer is migrate', async () => {
    const dir = await newRepo({ name: 'x', scripts: { test: 'node --test' } });
    const results = await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, vitest: 'migrate' } });
    const pkg = JSON.parse(await read(path.join(dir, 'package.json')));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:legacy']).toBe('node --test');
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBeDefined();
    expect(results.find((r) => r.file.endsWith('vitest.config.ts')).action).toBe('created');
    expect(results.find((r) => r.file.endsWith('tests/arch/standards.test.ts')).action).toBe('created');
  });

  it('skips existing files when answer is skip', async () => {
    const dir = await newRepo();
    await fs.writeFile(path.join(dir, 'eslint.config.mjs'), 'custom');
    const results = await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, eslint: 'skip' } });
    expect(await read(path.join(dir, 'eslint.config.mjs'))).toBe('custom');
    expect(results.find((r) => r.file.endsWith('eslint.config.mjs')).action).toBe('skipped');
  });

  it('skips existing ci.yml when answer is skip and overwrites on replace', async () => {
    const dir = await newRepo();
    await fs.mkdir(path.join(dir, '.github/workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, '.github/workflows/ci.yml'), 'old');
    await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, ci: 'skip' } });
    expect(await read(path.join(dir, '.github/workflows/ci.yml'))).toBe('old');
    const results = await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, ci: 'replace' } });
    expect(await read(path.join(dir, '.github/workflows/ci.yml'))).toContain('ci-node.yml@v1');
    expect(results.find((r) => r.file.endsWith('ci.yml')).action).toBe('overwritten');
  });

  it('merge keeps previous eslint config as eslint.config.local.mjs', async () => {
    const dir = await newRepo();
    await fs.writeFile(path.join(dir, 'eslint.config.mjs'), 'export default [{ rules: {} }];');
    const results = await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, eslint: 'merge' } });
    expect(await read(path.join(dir, 'eslint.config.local.mjs'))).toBe('export default [{ rules: {} }];');
    expect(await read(path.join(dir, 'eslint.config.mjs'))).toContain("from './eslint.config.local.mjs'");
    expect(results.find((r) => r.file.endsWith('eslint.config.mjs')).action).toBe('merged');
  });

  it('keeps an existing PR template and arch test', async () => {
    const dir = await newRepo();
    await fs.mkdir(path.join(dir, '.github'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests/arch'), { recursive: true });
    await fs.writeFile(path.join(dir, '.github/pull_request_template.md'), 'mine');
    await fs.writeFile(path.join(dir, 'tests/arch/standards.test.ts'), 'mine');
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    expect(await read(path.join(dir, '.github/pull_request_template.md'))).toBe('mine');
    expect(await read(path.join(dir, 'tests/arch/standards.test.ts'))).toBe('mine');
  });

  it('never writes outside targetDir', async () => {
    const dir = await newRepo();
    const results = await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    for (const r of results) expect(r.file.startsWith(dir)).toBe(true);
  });

  it('appends missing gitignore patterns once', async () => {
    const dir = await newRepo();
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n*.pdf\n');
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    await initProject({ targetDir: dir, answers: RECOMMENDED_ANSWERS });
    const content = await read(path.join(dir, '.gitignore'));
    expect(content.match(/^\*\.docx$/gm)).toHaveLength(1);
    expect(content.match(/^\*\.pdf$/gm)).toHaveLength(1);
    expect(content.startsWith('node_modules\n*.pdf\n')).toBe(true);
  });

  it('updateMode never makes dependabot ignore the standards package', async () => {
    const dir = await newRepo();
    await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, updateMode: 'never' } });
    expect(await read(path.join(dir, '.github/dependabot.yml'))).toMatch(/ignore:\s*\n\s*- dependency-name: "@oneup4real\/standards"/);
    expect(JSON.parse(await read(path.join(dir, '.standardsrc.json'))).updateMode).toBe('never');
  });

  it('updateMode auto adds the automerge workflow, review does not', async () => {
    const auto = await newRepo();
    await initProject({ targetDir: auto, answers: { ...RECOMMENDED_ANSWERS, updateMode: 'auto' } });
    expect(await exists(path.join(auto, '.github/workflows/standards-automerge.yml'))).toBe(true);
    const review = await newRepo();
    await initProject({ targetDir: review, answers: RECOMMENDED_ANSWERS });
    expect(await exists(path.join(review, '.github/workflows/standards-automerge.yml'))).toBe(false);
  });

  it('private repos without code scanning get semgrep instead of codeql', async () => {
    const dir = await newRepo();
    await initProject({ targetDir: dir, answers: { ...RECOMMENDED_ANSWERS, codeScanning: 'semgrep' } });
    const ci = await read(path.join(dir, '.github/workflows/ci.yml'));
    expect(ci).toContain('codeql: false');
    expect(ci).toContain('semgrep: true');
  });
});
