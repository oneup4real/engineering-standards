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
