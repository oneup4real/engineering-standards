#!/usr/bin/env node
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';

const code = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exit(code);
