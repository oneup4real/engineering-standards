// Command dispatcher for the `oneup-standards` binary.
// Each command is (args, io) => Promise<exitCode>; io abstracts cwd, env and output for testability.

/** @typedef {{ cwd: string, env: Record<string, string|undefined>, stdout: (s: string) => void, stderr: (s: string) => void }} Io */

/** @type {Record<string, (args: string[], io: Io) => Promise<number>>} */
export const commands = {};

const USAGE = `Usage: oneup-standards <command> [options]

Commands:
${'{{COMMANDS}}'}
`;

/** @type {Record<string, string>} */
const descriptions = {};

/**
 * Register a subcommand.
 * @param {string} name
 * @param {string} description
 * @param {(args: string[], io: Io) => Promise<number>} handler
 */
export function register(name, description, handler) {
  commands[name] = handler;
  descriptions[name] = description;
}

function usage() {
  const lines = Object.keys(descriptions)
    .sort()
    .map((name) => `  ${name.padEnd(14)} ${descriptions[name]}`);
  return USAGE.replace('{{COMMANDS}}', lines.join('\n') || '  (none)');
}

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {Promise<number>}
 */
export async function runCli(argv, io) {
  const [name, ...rest] = argv;
  const handler = name ? commands[name] : undefined;
  if (!handler) {
    io.stderr(usage());
    return 2;
  }
  return handler(rest, io);
}
