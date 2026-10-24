// Real process helpers used by commands (kept separate so logic modules stay testable).
import { spawn } from 'node:child_process';

/**
 * Runs a command with inherited stdio.
 * @param {string} cwd
 * @returns {(cmd: string, args: string[]) => Promise<{ code: number }>}
 */
export function makeExec(cwd) {
  return (cmd, args) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
      child.on('error', () => resolve({ code: 127 }));
      child.on('close', (code) => resolve({ code: code ?? 1 }));
    });
}

/**
 * Whether a binary is on PATH.
 * @param {string} bin
 */
export function which(bin) {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Runs a command and captures its output; optional text for stdin. Never rejects: a missing binary gives code 127.
 * @param {string} cwd
 * @returns {(cmd: string, args: string[], opts?: { input?: string }) => Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function makeRun(cwd) {
  return (cmd, args, opts = {}) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', () => resolve({ code: 127, stdout, stderr }));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input ?? '');
    });
}

/** Whether the npm registry is reachable (DNS lookup, 3 s). Never rejects. */
export async function online() {
  const { lookup } = await import('node:dns/promises');
  return Promise.race([
    lookup('registry.npmjs.org').then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000).unref()),
  ]);
}
