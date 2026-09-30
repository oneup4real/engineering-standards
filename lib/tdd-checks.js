// TDD enforcement: "source changed ⇒ tests changed" and coverage of the changed lines themselves.
import path from 'node:path';

const SOURCE_RE = /^(src|app|components|hooks|context|lib|server|domain|shared)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(tests?|__tests__)\//;
const NOT_LOGIC_RE = /\.d\.ts$/;

/**
 * Parses an lcov report into file → (line → hit count). Absolute paths under `root` become repo-relative.
 * @param {string} text
 * @param {string} root
 * @returns {Map<string, Map<number, number>>}
 */
export function parseLcov(text, root) {
  /** @type {Map<string, Map<number, number>>} */
  const files = new Map();
  /** @type {Map<number, number> | null} */
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const file = toRelative(line.slice(3), root);
      current = files.get(file) ?? new Map();
      files.set(file, current);
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',').map(Number);
      current.set(lineNo, (current.get(lineNo) ?? 0) + hits);
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return files;
}

/**
 * Collects the added/changed line numbers (new side) per file from `git diff -U0` output.
 * @param {string} text
 * @returns {Map<string, Set<number>>}
 */
export function parseUnifiedDiff(text) {
  /** @type {Map<string, Set<number>>} */
  const files = new Map();
  /** @type {Set<number> | null} */
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        current = null;
        continue;
      }
      const file = target.replace(/^b\//, '');
      current = files.get(file) ?? new Set();
      files.set(file, current);
    } else if (line.startsWith('@@') && current) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (!match) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let n = start; n < start + count; n++) current.add(n);
    }
  }
  return files;
}

/**
 * Coverage of changed lines. Lines that the coverage tool does not instrument (comments, types) are ignored.
 * @param {Map<string, Map<number, number>>} coverage
 * @param {Map<string, Set<number>>} changed
 */
export function computeDiffCoverage(coverage, changed) {
  let covered = 0;
  let total = 0;
  /** @type {{ file: string, lines: number[] }[]} */
  const uncovered = [];
  for (const [file, lines] of changed) {
    const hits = coverage.get(file);
    if (!hits) continue;
    const missed = [];
    for (const n of [...lines].sort((a, b) => a - b)) {
      if (!hits.has(n)) continue;
      total += 1;
      if ((hits.get(n) ?? 0) > 0) covered += 1;
      else missed.push(n);
    }
    if (missed.length > 0) uncovered.push({ file, lines: missed });
  }
  const percent = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
  return { covered, total, percent, uncovered };
}

/**
 * Source code changed ⇒ at least one test file must change too.
 * @param {string[]} changedPaths
 */
export function checkTestsChanged(changedPaths) {
  const testFiles = changedPaths.filter((p) => TEST_RE.test(p));
  const sourceFiles = changedPaths.filter((p) => SOURCE_RE.test(p) && !TEST_RE.test(p) && !NOT_LOGIC_RE.test(p));
  return { ok: sourceFiles.length === 0 || testFiles.length > 0, sourceFiles, testFiles };
}

/** @param {string} file @param {string} root */
function toRelative(file, root) {
  const normalized = file.replaceAll('\\', '/');
  return path.isAbsolute(file) ? path.relative(root, file).replaceAll('\\', '/') : normalized.replace(/^\.\//, '');
}

/**
 * Formats uncovered lines as "file: 2, 5-7".
 * @param {{ file: string, lines: number[] }} entry
 */
export function formatUncovered({ file, lines }) {
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    ranges.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j;
  }
  return `${file}: ${ranges.join(', ')}`;
}
