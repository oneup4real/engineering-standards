import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initProject, RECOMMENDED_ANSWERS } from '../lib/init.js';
import { inspectProject, upgradeProject } from '../lib/doctor.js';
import { hashContent } from '../lib/templates.js';
import { BEGIN_MARKER, END_MARKER } from '../lib/managed-block.js';
import { tempDir, makeIo } from './helpers.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';

// No hooks: the gitleaks check (which depends on this machine) is skipped, keeping exit codes deterministic.
const NO_HOOKS = { ...RECOMMENDED_ANSWERS, hooks: false };

describe('doctor / upgrade commands', () => {
  it('doctor exits 0 and says so when everything is up to date', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor'], io)).toBe(0);
    expect(io.out).toMatch(/up to date with @oneup4real\/standards/);
  });

  it('doctor exits 1 and lists what needs attention', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    await fs.rm(path.join(dir, '.github/pull_request_template.md'));
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor'], io)).toBe(1);
    expect(io.out).toMatch(/missing\s+\.github\/pull_request_template\.md/);
    expect(io.out).toMatch(/npx oneup-standards upgrade/);
  });

  it('doctor --warn-only prints GitHub warnings and exits 0', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    await fs.rm(path.join(dir, '.github/pull_request_template.md'));
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['doctor', '--warn-only'], io)).toBe(0);
    expect(io.out).toMatch(/::warning file=\.github\/pull_request_template\.md::/);
  });

  it('doctor exits 2 for a project that is not connected', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    const io = makeIo(dir, { HOME: await tempDir() });
    expect(await runCli(['doctor'], io)).toBe(2);
    expect(io.err).toMatch(/oneup-standards init/);
  });

  it('upgrade fixes the project and prints a summary', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    await fs.rm(path.join(dir, '.github/pull_request_template.md'));
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['upgrade'], io)).toBe(0);
    expect(io.out).toMatch(/created\s+\.github\/pull_request_template\.md/);
    expect(await runCli(['doctor'], makeIo(dir, { HOME: home }))).toBe(0);
  });

  it('upgrade --dry-run only shows what would change', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    await fs.rm(path.join(dir, '.github/pull_request_template.md'));
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['upgrade', '--dry-run'], io)).toBe(0);
    expect(io.out).toMatch(/dry run/i);
    expect(await exists(path.join(dir, '.github/pull_request_template.md'))).toBe(false);
  });

  it('upgrade mentions files it left alone and how to replace them', async () => {
    const { dir, home } = await connectedProject(NO_HOOKS);
    await fs.appendFile(path.join(dir, '.github/pull_request_template.md'), '\nmine\n');
    const io = makeIo(dir, { HOME: home });
    expect(await runCli(['upgrade'], io)).toBe(0);
    expect(io.out).toMatch(/skipped\s+\.github\/pull_request_template\.md/);
    expect(io.out).toMatch(/--force/);
  });
});

const read = (p) => fs.readFile(p, 'utf8');
const exists = (p) => fs.access(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await read(p));
const writeJson = (p, v) => fs.writeFile(p, `${JSON.stringify(v, null, 2)}\n`);

/** A project set up by the wizard with the recommended answers. */
async function connectedProject(answers = RECOMMENDED_ANSWERS) {
  const dir = await tempDir();
  const home = await tempDir('oneup-home-');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '16' } }, null, 2));
  await initProject({ targetDir: dir, answers, homeDir: home });
  return { dir, home };
}

const itemFor = (report, file) => report.items.find((i) => i.file === file);
const statusOf = (report, file) => itemFor(report, file)?.status;
const notOk = (report) => report.items.filter((i) => i.status !== 'ok');

describe('init records what it wrote', () => {
  it('stores template hashes and the code scanner in .standardsrc.json', async () => {
    const { dir } = await connectedProject();
    const config = await readJson(path.join(dir, '.standardsrc.json'));
    expect(config.codeScanning).toBe('semgrep');
    const ci = await read(path.join(dir, '.github/workflows/ci.yml'));
    expect(config.managed['.github/workflows/ci.yml']).toBe(hashContent(ci));
    for (const f of ['.github/pull_request_template.md', '.lintstagedrc.json', '.dependency-cruiser.cjs', 'eslint.config.mjs']) {
      expect(config.managed[f], f).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('inspectProject', () => {
  it('reports everything ok right after init', async () => {
    const { dir, home } = await connectedProject();
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    expect(report.connected).toBe(true);
    expect(notOk(report)).toEqual([]);
  });

  it('reports ok for a project pinned with updateMode never and CodeQL', async () => {
    const { dir, home } = await connectedProject({ ...RECOMMENDED_ANSWERS, updateMode: 'never', codeScanning: 'codeql' });
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    expect(notOk(report)).toEqual([]);
  });

  it('checks the automerge workflow only in auto mode', async () => {
    const auto = await connectedProject({ ...RECOMMENDED_ANSWERS, updateMode: 'auto' });
    expect(statusOf(await inspectProject({ targetDir: auto.dir, homeDir: auto.home }), '.github/workflows/standards-automerge.yml')).toBe('ok');
    const review = await connectedProject();
    expect(itemFor(await inspectProject({ targetDir: review.dir, homeDir: review.home }), '.github/workflows/standards-automerge.yml')).toBeUndefined();
  });

  it('treats CRLF line endings as equal', async () => {
    const { dir, home } = await connectedProject();
    const file = path.join(dir, '.github/pull_request_template.md');
    await fs.writeFile(file, (await read(file)).replaceAll('\n', '\r\n'));
    expect(statusOf(await inspectProject({ targetDir: dir, homeDir: home }), '.github/pull_request_template.md')).toBe('ok');
  });

  it('reports a file edited by the user as customized', async () => {
    const { dir, home } = await connectedProject();
    await fs.appendFile(path.join(dir, '.github/pull_request_template.md'), '\n- [ ] project-specific check\n');
    const item = itemFor(await inspectProject({ targetDir: dir, homeDir: home }), '.github/pull_request_template.md');
    expect(item.status).toBe('customized');
    expect(item.message).toMatch(/--force/);
  });

  it('reports an untouched file from an older template as outdated', async () => {
    const { dir, home } = await connectedProject();
    const old = '# old PR template\n';
    await fs.writeFile(path.join(dir, '.github/pull_request_template.md'), old);
    const configFile = path.join(dir, '.standardsrc.json');
    const config = await readJson(configFile);
    config.managed['.github/pull_request_template.md'] = hashContent(old);
    await writeJson(configFile, config);
    expect(statusOf(await inspectProject({ targetDir: dir, homeDir: home }), '.github/pull_request_template.md')).toBe('outdated');
  });

  it('reports a deleted managed file as missing', async () => {
    const { dir, home } = await connectedProject();
    await fs.rm(path.join(dir, '.lintstagedrc.json'));
    expect(statusOf(await inspectProject({ targetDir: dir, homeDir: home }), '.lintstagedrc.json')).toBe('missing');
  });

  it('reports a hook without the standards line as missing', async () => {
    const { dir, home } = await connectedProject();
    await fs.writeFile(path.join(dir, '.husky/pre-commit'), 'npm run something\n');
    expect(statusOf(await inspectProject({ targetDir: dir, homeDir: home }), '.husky/pre-commit')).toBe('missing');
  });

  it('reports an AGENTS.md block with old rules as outdated', async () => {
    const { dir, home } = await connectedProject();
    const file = path.join(dir, 'AGENTS.md');
    const text = await read(file);
    const start = text.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length;
    await fs.writeFile(file, `${text.slice(0, start)}\nold rules\n${text.slice(text.indexOf(END_MARKER))}`);
    expect(statusOf(await inspectProject({ targetDir: dir, homeDir: home }), 'AGENTS.md')).toBe('outdated');
  });

  it('reports missing .gitignore patterns and package scripts', async () => {
    const { dir, home } = await connectedProject();
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    const pkgFile = path.join(dir, 'package.json');
    const pkg = await readJson(pkgFile);
    delete pkg.scripts['check:arch'];
    await writeJson(pkgFile, pkg);
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    expect(statusOf(report, '.gitignore')).toBe('missing');
    expect(statusOf(report, 'package.json')).toBe('missing');
    expect(itemFor(report, 'package.json').message).toMatch(/check:arch/);
  });

  it('warns when hooks are used but gitleaks is not installed', async () => {
    const { dir, home } = await connectedProject();
    const report = await inspectProject({ targetDir: dir, homeDir: home, which: async () => false });
    const item = report.items.find((i) => i.id === 'gitleaks');
    expect(item.status).toBe('warning');
    expect(item.message).toMatch(/brew install gitleaks/);
  });

  it('says "not connected" for a project without the standards package', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'plain' }));
    const report = await inspectProject({ targetDir: dir, homeDir: await tempDir() });
    expect(report.connected).toBe(false);
    expect(report.items[0].message).toMatch(/oneup-standards init/);
  });

  it('handles projects set up before hashes were recorded (v1.0 to v1.2)', async () => {
    const { dir, home } = await connectedProject({ ...RECOMMENDED_ANSWERS, codeScanning: 'codeql' });
    const configFile = path.join(dir, '.standardsrc.json');
    const config = await readJson(configFile);
    delete config.managed;
    delete config.codeScanning;
    await writeJson(configFile, config);
    await fs.appendFile(path.join(dir, '.lintstagedrc.json'), ' ');
    const report = await inspectProject({ targetDir: dir, homeDir: home });
    // ci.yml still equals the template: the scanner is inferred from it.
    expect(statusOf(report, '.github/workflows/ci.yml')).toBe('ok');
    // without a record, any difference counts as a user change
    expect(statusOf(report, '.lintstagedrc.json')).toBe('customized');
  });

  it('never calls a ci.yml that is not the shared pipeline outdated', async () => {
    const { dir, home } = await connectedProject({ ...RECOMMENDED_ANSWERS });
    const configFile = path.join(dir, '.standardsrc.json');
    const config = await readJson(configFile);
    delete config.managed['.github/workflows/ci.yml'];
    await writeJson(configFile, config);
    await fs.writeFile(path.join(dir, '.github/workflows/ci.yml'), 'name: my own CI\n');
    const item = itemFor(await inspectProject({ targetDir: dir, homeDir: home }), '.github/workflows/ci.yml');
    expect(item.status).toBe('customized');
  });
});

describe('upgradeProject', () => {
  it('replaces outdated files, creates missing ones and records hashes', async () => {
    const { dir, home } = await connectedProject();
    const old = '# old PR template\n';
    const prFile = path.join(dir, '.github/pull_request_template.md');
    await fs.writeFile(prFile, old);
    const configFile = path.join(dir, '.standardsrc.json');
    const config = await readJson(configFile);
    config.managed['.github/pull_request_template.md'] = hashContent(old);
    await writeJson(configFile, config);
    await fs.rm(path.join(dir, '.lintstagedrc.json'));

    const results = await upgradeProject({ targetDir: dir, homeDir: home });

    expect(await read(prFile)).not.toBe(old);
    expect(await exists(path.join(dir, '.lintstagedrc.json'))).toBe(true);
    expect(results.find((r) => r.file.endsWith('pull_request_template.md')).action).toBe('updated');
    expect(results.find((r) => r.file.endsWith('.lintstagedrc.json')).action).toBe('created');
    const after = await readJson(configFile);
    expect(after.managed['.github/pull_request_template.md']).toBe(hashContent(await read(prFile)));
    expect(notOk(await inspectProject({ targetDir: dir, homeDir: home }))).toEqual([]);
  });

  it('leaves customized files alone without --force', async () => {
    const { dir, home } = await connectedProject();
    const prFile = path.join(dir, '.github/pull_request_template.md');
    await fs.appendFile(prFile, '\nmine\n');
    const before = await read(prFile);
    const results = await upgradeProject({ targetDir: dir, homeDir: home });
    expect(await read(prFile)).toBe(before);
    expect(results.find((r) => r.file.endsWith('pull_request_template.md')).action).toBe('skipped');
  });

  it('replaces customized files with --force and keeps a .bak copy', async () => {
    const { dir, home } = await connectedProject();
    const prFile = path.join(dir, '.github/pull_request_template.md');
    await fs.appendFile(prFile, '\nmine\n');
    const before = await read(prFile);
    const results = await upgradeProject({ targetDir: dir, homeDir: home, force: true });
    expect(await read(`${prFile}.bak`)).toBe(before);
    expect(await read(prFile)).not.toBe(before);
    expect(results.find((r) => r.file.endsWith('pull_request_template.md')).action).toBe('overwritten');
  });

  it('fixes hooks, the AGENTS.md block, .gitignore and scripts while keeping user content', async () => {
    const { dir, home } = await connectedProject();
    await fs.writeFile(path.join(dir, '.husky/pre-commit'), 'npm run something\n');
    const agentsFile = path.join(dir, 'AGENTS.md');
    const text = await read(agentsFile);
    const start = text.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length;
    await fs.writeFile(agentsFile, `# My project\n\n${text.slice(0, start)}\nold rules\n${text.slice(text.indexOf(END_MARKER))}`);
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    const pkgFile = path.join(dir, 'package.json');
    const pkg = await readJson(pkgFile);
    delete pkg.scripts.lint;
    await writeJson(pkgFile, pkg);

    await upgradeProject({ targetDir: dir, homeDir: home });

    const hook = await read(path.join(dir, '.husky/pre-commit'));
    expect(hook).toContain('npm run something');
    expect(hook).toContain('oneup-standards hook pre-commit');
    const agents = await read(agentsFile);
    expect(agents).toContain('# My project');
    expect(agents).not.toContain('old rules');
    expect(await read(path.join(dir, '.gitignore'))).toMatch(/^node_modules\n[\s\S]*\.env\*/);
    expect((await readJson(pkgFile)).scripts.lint).toBe('eslint .');
    expect(notOk(await inspectProject({ targetDir: dir, homeDir: home }))).toEqual([]);
  });

  it('records hashes for legacy projects whose files still equal the template', async () => {
    const { dir, home } = await connectedProject({ ...RECOMMENDED_ANSWERS, codeScanning: 'codeql' });
    const configFile = path.join(dir, '.standardsrc.json');
    const config = await readJson(configFile);
    delete config.managed;
    delete config.codeScanning;
    await writeJson(configFile, config);
    await upgradeProject({ targetDir: dir, homeDir: home });
    const after = await readJson(configFile);
    expect(after.codeScanning).toBe('codeql');
    expect(after.managed['.github/workflows/ci.yml']).toMatch(/^sha256:/);
    expect(after.bundleDir).toBe(config.bundleDir);
  });

  it('writes nothing with dryRun', async () => {
    const { dir, home } = await connectedProject();
    await fs.rm(path.join(dir, '.lintstagedrc.json'));
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    const configBefore = await read(path.join(dir, '.standardsrc.json'));
    const results = await upgradeProject({ targetDir: dir, homeDir: home, dryRun: true });
    expect(await exists(path.join(dir, '.lintstagedrc.json'))).toBe(false);
    expect(await read(path.join(dir, '.gitignore'))).toBe('node_modules\n');
    expect(await read(path.join(dir, '.standardsrc.json'))).toBe(configBefore);
    expect(results.find((r) => r.file.endsWith('.lintstagedrc.json')).action).toBe('created');
  });

  it('refuses to upgrade a project that is not connected', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'plain' }));
    await expect(upgradeProject({ targetDir: dir, homeDir: await tempDir() })).rejects.toThrow(/oneup-standards init/);
  });
});
