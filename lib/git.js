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
