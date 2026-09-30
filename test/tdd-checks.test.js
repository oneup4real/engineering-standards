import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLcov, parseUnifiedDiff, computeDiffCoverage, checkTestsChanged } from '../lib/tdd-checks.js';
import { defineStandardsConfig } from '../vitest/index.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { makeIo, tempDir } from './helpers.js';

const LCOV = `SF:src/domain/risk.ts
DA:1,1
DA:2,0
DA:3,4
end_of_record
SF:${process.cwd()}/src/app/page.tsx
DA:10,0
end_of_record
`;

const DIFF = `diff --git a/src/domain/risk.ts b/src/domain/risk.ts
--- a/src/domain/risk.ts
+++ b/src/domain/risk.ts
@@ -1,0 +2,2 @@
+changed
+changed
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -5 +5 @@
-old
+new
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+x
`;

describe('parseLcov', () => {
  it('maps files to line hits and normalizes absolute paths', () => {
    const cov = parseLcov(LCOV, process.cwd());
    expect(cov.get('src/domain/risk.ts')).toEqual(new Map([[1, 1], [2, 0], [3, 4]]));
    expect(cov.get('src/app/page.tsx')).toEqual(new Map([[10, 0]]));
  });
});

describe('parseUnifiedDiff', () => {
  it('collects added/changed line numbers per new file path', () => {
    const diff = parseUnifiedDiff(DIFF);
    expect(diff.get('src/domain/risk.ts')).toEqual(new Set([2, 3]));
    expect(diff.get('README.md')).toEqual(new Set([5]));
    expect(diff.get('src/new.ts')).toEqual(new Set([1]));
  });
});

describe('computeDiffCoverage', () => {
  it('counts only changed lines that are instrumented', () => {
    const result = computeDiffCoverage(parseLcov(LCOV, process.cwd()), parseUnifiedDiff(DIFF));
    expect(result).toMatchObject({ covered: 1, total: 2, percent: 50 });
    expect(result.uncovered).toEqual([{ file: 'src/domain/risk.ts', lines: [2] }]);
  });

  it('reports 100% when no instrumented line changed', () => {
    const result = computeDiffCoverage(new Map(), parseUnifiedDiff(DIFF));
    expect(result).toMatchObject({ covered: 0, total: 0, percent: 100 });
  });
});

describe('checkTestsChanged', () => {
  it('fails when source changed without any test change', () => {
    const r = checkTestsChanged(['src/domain/risk.ts', 'README.md']);
    expect(r.ok).toBe(false);
    expect(r.sourceFiles).toEqual(['src/domain/risk.ts']);
  });

  it('passes when a test changed alongside', () => {
    expect(checkTestsChanged(['src/domain/risk.ts', 'src/domain/risk.test.ts']).ok).toBe(true);
    expect(checkTestsChanged(['src/a.ts', 'tests/arch/x.test.ts']).ok).toBe(true);
  });

  it('ignores non-code changes, type declarations and config', () => {
    expect(checkTestsChanged(['README.md', 'src/types.d.ts', 'package.json', 'src/app/globals.css']).ok).toBe(true);
  });

  it('counts root-level app/ and lib/ as source', () => {
    expect(checkTestsChanged(['app/page.tsx']).ok).toBe(false);
  });
});

describe('vitest preset produces what the checks need', () => {
  it('writes lcov and includes all source files', () => {
    const c = defineStandardsConfig().test.coverage;
    expect(c.reporter).toContain('lcov');
    expect(c.include).toEqual(expect.arrayContaining(['src/**']));
  });
});

describe('CLI', () => {
  it('check-diff-coverage fails below the minimum and lists uncovered lines', async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, 'coverage'));
    await fs.writeFile(path.join(dir, 'coverage/lcov.info'), LCOV);
    await fs.writeFile(path.join(dir, 'change.diff'), DIFF);
    const io = makeIo(dir);
    expect(await runCli(['check-diff-coverage', '--diff-file', 'change.diff', '--min', '80'], io)).toBe(1);
    expect(io.err).toContain('src/domain/risk.ts: 2');
  });

  it('check-diff-coverage exits 2 without a coverage report unless --if-present', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'change.diff'), DIFF);
    expect(await runCli(['check-diff-coverage', '--diff-file', 'change.diff'], makeIo(dir))).toBe(2);
    const io = makeIo(dir);
    expect(await runCli(['check-diff-coverage', '--diff-file', 'change.diff', '--if-present'], io)).toBe(0);
    expect(io.out).toContain('::warning::');
  });

  it('check-tests-changed takes explicit paths', async () => {
    expect(await runCli(['check-tests-changed', 'src/a.ts'], makeIo())).toBe(1);
    expect(await runCli(['check-tests-changed', 'src/a.ts', 'src/a.test.ts'], makeIo())).toBe(0);
  });
});
