import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { parse } from 'yaml';

const load = async (p) => parse((await fs.readFile(p, 'utf8')).replace(/\{\{(\w+)\}\}/g, 'true'));

describe('consumer ci.yml matches the reusable workflows', () => {
  it('every with: key exists as a workflow_call input', async () => {
    const consumer = await load('templates/consumer/.github/workflows/ci.yml');
    for (const [job, file] of [['ci', 'ci-node.yml'], ['security', 'security.yml']]) {
      const reusable = await load(`.github/workflows/${file}`);
      const inputs = Object.keys(reusable.on.workflow_call.inputs);
      expect(consumer.jobs[job].uses).toBe(`oneup4real/engineering-standards/.github/workflows/${file}@v1`);
      for (const key of Object.keys(consumer.jobs[job].with ?? {})) expect(inputs, `${file}: ${key}`).toContain(key);
    }
  });

  it('wizard required checks match real job ids', async () => {
    const security = await load('.github/workflows/security.yml');
    const ciNode = await load('.github/workflows/ci-node.yml');
    const src = await fs.readFile('lib/wizard.js', 'utf8');
    const checks = JSON.parse(src.match(/REQUIRED_CHECKS = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
    for (const check of checks) {
      const [caller, job] = check.split(' / ');
      const jobs = caller === 'ci' ? ciNode.jobs : security.jobs;
      expect(Object.keys(jobs), check).toContain(job);
    }
  });

  it('every third-party action is pinned to a full commit SHA', async () => {
    const files = ['.github/workflows/ci-node.yml', '.github/workflows/security.yml', '.github/workflows/self-ci.yml',
      'templates/consumer/.github/workflows/standards-automerge.yml'];
    for (const f of files) {
      const text = await fs.readFile(f, 'utf8');
      for (const [, ref] of text.matchAll(/uses:\s*[\w.-]+\/[\w./-]+@(\S+)/g)) {
        if (ref === 'v1') continue; // our own reusable workflows, versioned by tag on purpose
        expect(ref, `${f}: ${ref}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});

describe('TDD enforcement in ci-node.yml', () => {
  it('runs tests with coverage, the tests-changed check and changed-line coverage on PRs', async () => {
    const ci = await load('.github/workflows/ci-node.yml');
    const inputs = ci.on.workflow_call.inputs;
    expect(inputs['require-tests'].default).toBe(true);
    expect(inputs['min-diff-coverage'].default).toBe(80);
    const steps = ci.jobs.ci.steps;
    const run = (name) => steps.find((s) => s.name === name);
    expect(run('Unit tests (with coverage)').run).toContain('--coverage');
    expect(run('Tests changed with the code (TDD)').if).toContain("github.event_name == 'pull_request'");
    expect(run('Tests changed with the code (TDD)').if).toContain('no-tests-needed');
    expect(run('Changed-line coverage').run).toContain('check-diff-coverage');
    expect(steps[0].with['fetch-depth']).toBe(0);
  });

  it('PR template asks for test-first', async () => {
    expect(await fs.readFile('templates/consumer/.github/pull_request_template.md', 'utf8')).toMatch(/test first|failing test/i);
  });
});

describe('gitleaks in security.yml', () => {
  it('runs a pinned, checksum-verified gitleaks binary over the full history', async () => {
    const sec = await load('.github/workflows/security.yml');
    const steps = sec.jobs.gitleaks.steps;
    const script = steps.map((s) => s.run ?? '').join('\n');
    expect(steps.some((s) => String(s.uses ?? '').startsWith('gitleaks/gitleaks-action'))).toBe(false);
    const env = Object.assign({}, ...steps.map((s) => s.env ?? {}));
    expect(env.GITLEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.GITLEAKS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(script).toContain('gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz');
    expect(script).toMatch(/sha256sum -c/);
    expect(script).toMatch(/gitleaks"? git .*--redact/);
    expect(steps[0].with['fetch-depth']).toBe(0);
  });
});
