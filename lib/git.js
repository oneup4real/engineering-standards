// Small git helpers shared by commands.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Paths staged for commit (added, copied, modified, renamed).
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function stagedPaths(cwd) {
  const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter(Boolean);
}

/**
 * Files changed between `base` and HEAD (merge-base diff, like a pull request).
 * @param {string} cwd
 * @param {string} base
 */
export async function changedPaths(cwd, base) {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split('\0').filter(Boolean);
}

/**
 * Zero-context diff between `base` and HEAD.
 * @param {string} cwd
 * @param {string} base
 */
export async function gitDiff(cwd, base) {
  const { stdout } = await execFileAsync('git', ['diff', '-U0', '--no-color', `${base}...HEAD`], { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/**
 * Whether package-lock.json differs from the upstream branch (or origin's default branch when none is set).
 * @param {string} cwd
 */
export async function lockfileChanged(cwd) {
  const git = (/** @type {string[]} */ args) => execFileAsync('git', args, { cwd }).then((r) => r.stdout.trim(), () => null);
  const candidates = [await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), 'origin/main', 'origin/master'];
  for (const base of candidates) {
    if (!base || (await git(['rev-parse', '--verify', '--quiet', base])) === null) continue;
    const names = await git(['diff', '--name-only', `${base}...HEAD`, '--', 'package-lock.json']);
    return Boolean(names);
  }
  return false;
}
