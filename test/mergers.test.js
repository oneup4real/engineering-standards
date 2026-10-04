import { describe, expect, it } from 'vitest';
import { mergeYamlWorkflow, mergeMarkdownSections, mergeJson, mergeTemplateFile } from '../lib/mergers.js';

describe('mergers', () => {
  describe('mergeYamlWorkflow', () => {
    it('preserves custom jobs and adds missing security job', () => {
      const existing = `name: Custom CI
on:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
      const template = `name: CI
on:
  push:
    branches: [main]

jobs:
  ci:
    uses: oneup4real/engineering-standards/.github/workflows/ci-node.yml@v1
  security:
    uses: oneup4real/engineering-standards/.github/workflows/security.yml@v1
    with:
      semgrep: true
`;
      const merged = mergeYamlWorkflow(existing, template);
      expect(merged).toContain('name: Custom CI');
      expect(merged).toContain('validate:');
      expect(merged).toContain('npm test');
      expect(merged).toContain('security:');
      expect(merged).toContain('semgrep: true');
      // Keeps custom validate runner, does not duplicate with generic ci job
      expect(merged).not.toContain('ci-node.yml');
    });

    it('adds ci job if existing workflow only has security job', () => {
      const existing = `name: CI
jobs:
  security:
    uses: oneup4real/engineering-standards/.github/workflows/security.yml@v1
`;
      const template = `name: CI
jobs:
  ci:
    uses: oneup4real/engineering-standards/.github/workflows/ci-node.yml@v1
  security:
    uses: oneup4real/engineering-standards/.github/workflows/security.yml@v1
`;
      const merged = mergeYamlWorkflow(existing, template);
      expect(merged).toContain('ci-node.yml');
    });

    it('does not duplicate existing security job', () => {
      const existing = `name: CI
jobs:
  security:
    uses: my-custom-security
`;
      const template = `name: CI
jobs:
  security:
    uses: standard-security
`;
      const merged = mergeYamlWorkflow(existing, template);
      expect(merged).toContain('my-custom-security');
      expect(merged).not.toContain('standard-security');
    });
  });

  describe('mergeMarkdownSections', () => {
    it('inserts missing markdown sections while keeping existing sections', () => {
      const existing = `## What & why

My custom project explanation.

## Checks

- [ ] npm test
`;
      const template = `## What & why

<!-- Template -->

## Tests (test-driven development)

- [ ] Test first: each test was written and seen failing before the code

## Checks

- [ ] npm run lint
- [ ] npm test
`;
      const merged = mergeMarkdownSections(existing, template);
      expect(merged).toContain('My custom project explanation.');
      expect(merged).toContain('## Tests (test-driven development)');
      expect(merged).toContain('Test first: each test was written');
      expect(merged).toContain('- [ ] npm run lint');
      expect(merged).toContain('- [ ] npm test');
    });
  });

  describe('mergeJson', () => {
    it('preserves existing json keys and adds missing keys from template', () => {
      const existing = JSON.stringify({
        '*.ts': 'prettier --write',
      }, null, 2);
      const template = JSON.stringify({
        '*.{ts,tsx,js,jsx,mjs,cjs}': 'eslint --max-warnings=0',
      }, null, 2);
      const merged = mergeJson(existing, template);
      const parsed = JSON.parse(merged);
      expect(parsed['*.ts']).toBe('prettier --write');
      expect(parsed['*.{ts,tsx,js,jsx,mjs,cjs}']).toBe('eslint --max-warnings=0');
    });
  });

  describe('mergeTemplateFile', () => {
    it('routes yaml workflows to mergeYamlWorkflow', () => {
      const existing = 'name: Custom\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
      const template = 'name: Standard\njobs:\n  security:\n    uses: sec@v1\n';
      const res = mergeTemplateFile('.github/workflows/ci.yml', existing, template);
      expect(res.canMerge).toBe(true);
      expect(res.hasChanges).toBe(true);
      expect(res.mergedContent).toContain('security:');
      expect(res.mergedContent).toContain('build:');
    });

    it('routes markdown files to mergeMarkdownSections', () => {
      const existing = '## Section 1\nContent\n';
      const template = '## Section 1\nContent\n\n## Section 2\nNew\n';
      const res = mergeTemplateFile('.github/pull_request_template.md', existing, template);
      expect(res.canMerge).toBe(true);
      expect(res.hasChanges).toBe(true);
      expect(res.mergedContent).toContain('## Section 2');
    });

    it('returns canMerge: false for unsupported file extensions', () => {
      const existing = 'const foo = 1;';
      const template = 'const foo = 2;';
      const res = mergeTemplateFile('.dependency-cruiser.cjs', existing, template);
      expect(res.canMerge).toBe(false);
      expect(res.hasChanges).toBe(false);
    });
  });
});
