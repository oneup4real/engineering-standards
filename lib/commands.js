// Registers every subcommand with the CLI dispatcher.
import path from 'node:path';
import { register } from './cli.js';
import { findForbiddenFiles } from './forbidden-files.js';
import { stagedPaths, changedPaths, gitDiff } from './git.js';

register('check-files', 'Fail if paths (default: staged files) include documents, env files or keys', async (args, io) => {
  const { readStandardsConfig } = await import('./config.js');
  const config = await readStandardsConfig(io.cwd);
  const ignore = config?.checkFiles?.ignore ?? config?.allowedFiles ?? [];
  const paths = args.length > 0 ? args : await stagedPaths(io.cwd);
  const offenders = findForbiddenFiles(paths, { ignore });
  if (offenders.length === 0) return 0;
  io.stderr('✖ These files must not be committed:\n');
  for (const o of offenders) io.stderr(`  ${o.path}  → ${o.reason}\n`);
  io.stderr('\nRemove them from the commit (git restore --staged <file>) and store them outside the repository.\n');
  return 1;
});

register('sync-agents', 'Write the shared rules into AGENTS.md and tool pointer files (--global: your home directory)', async (args, io) => {
  const { syncAgents } = await import('./sync-agents.js');
  const os = await import('node:os');
  const results = await syncAgents({ targetDir: io.cwd, global: args.includes('--global'), homeDir: io.env.HOME || os.homedir() });
  for (const r of results) io.stdout(`${r.action.padEnd(10)} ${r.file}\n`);
  return 0;
});

register('check-bundle', 'Fail if built client JS contains confidential markers from .standardsrc.json', async (args, io) => {
  const { checkBundle, BundleDirError } = await import('./bundle-check.js');
  const { readStandardsConfig } = await import('./config.js');
  const config = await readStandardsConfig(io.cwd);
  const markers = config.bundleForbiddenMarkers ?? [];
  if (markers.length === 0) {
    io.stderr('✖ No markers configured. Add strings that must never reach the browser to "bundleForbiddenMarkers" in .standardsrc.json\n');
    return 2;
  }
  const dirArg = args.indexOf('--dir');
  const dir = path.resolve(io.cwd, dirArg >= 0 ? args[dirArg + 1] : config.bundleDir ?? '.next/static');
  try {
    const hits = await checkBundle({ dir, markers });
    if (hits.length === 0) {
      io.stdout(`✔ No confidential markers in ${dir}\n`);
      return 0;
    }
    io.stderr('✖ Confidential data found in the client bundle (anyone can download these files):\n');
    for (const h of hits) io.stderr(`  ${path.relative(io.cwd, h.path)}  contains "${h.marker}"\n`);
    io.stderr('\nFind which src/ file imports that data and move it to server-only code.\n');
    return 1;
  } catch (error) {
    if (error instanceof BundleDirError) {
      io.stderr(`✖ ${error.message}\n`);
      return 2;
    }
    throw error;
  }
});

register('hook', 'Run a git hook: hook pre-commit | hook pre-push', async (args, io) => {
  const { preCommit, prePush } = await import('./hooks.js');
  const { makeExec, which } = await import('./process.js');
  const { readStandardsConfig } = await import('./config.js');
  const deps = { exec: makeExec(io.cwd), which, stagedPaths: () => stagedPaths(io.cwd), readConfig: () => readStandardsConfig(io.cwd) };
  if (args[0] === 'pre-commit') return preCommit(io, deps);
  if (args[0] === 'pre-push') return prePush(io, deps);
  io.stderr('Usage: oneup-standards hook <pre-commit|pre-push>\n');
  return 2;
});

register('init', 'Interactive setup wizard for a new or existing project (--yes: accept recommended answers)', async (args, io) => {
  const { runWizard } = await import('./wizard.js');
  const { terminalPrompt } = await import('./prompt.js');
  const { makeExec, which } = await import('./process.js');
  return runWizard(io, { prompt: terminalPrompt, exec: makeExec(io.cwd), which, yes: args.includes('--yes') });
});

register('baseline', 'Record current architecture violations so only new ones fail', async (_args, io) => {
  const { writeBaseline } = await import('./init.js');
  const { makeExec } = await import('./process.js');
  const code = await writeBaseline({ targetDir: io.cwd, exec: makeExec(io.cwd) });
  if (code === 0) io.stdout('✔ Wrote .dependency-cruiser-known-violations.json. Commit it; it may only shrink from now on.\n');
  return code;
});

/** @param {string[]} args @param {string} flag */
const option = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

register('check-tests-changed', 'Fail if source files changed without any test change (--base <ref> or explicit paths)', async (args, io) => {
  const { checkTestsChanged } = await import('./tdd-checks.js');
  const base = option(args, '--base');
  const paths = base ? await changedPaths(io.cwd, base) : args.filter((a) => !a.startsWith('--'));
  const result = checkTestsChanged(paths);
  if (result.ok) {
    io.stdout(`✔ ${result.sourceFiles.length} source file(s) changed, ${result.testFiles.length} test file(s) changed\n`);
    return 0;
  }
  io.stderr('✖ Source code changed, but no test file changed (test-driven development: write the test first).\n');
  for (const f of result.sourceFiles) io.stderr(`  ${f}\n`);
  io.stderr('\nAdd or update a test that covers the change. If no test is truly needed (e.g. pure refactor already\ncovered, copy change), add the label "no-tests-needed" to the pull request and explain why in the description.\n');
  return 1;
});

register('check-diff-coverage', 'Fail if changed lines are below --min % covered (--base <ref> | --diff-file f, --lcov coverage/lcov.info)', async (args, io) => {
  const fs = await import('node:fs/promises');
  const { parseLcov, parseUnifiedDiff, computeDiffCoverage, formatUncovered } = await import('./tdd-checks.js');
  const min = Number(option(args, '--min') ?? 80);
  const lcovPath = path.resolve(io.cwd, option(args, '--lcov') ?? 'coverage/lcov.info');
  const lcov = await fs.readFile(lcovPath, 'utf8').catch(() => null);
  if (lcov === null) {
    if (args.includes('--if-present')) {
      io.stdout(`::warning::No coverage report at ${path.relative(io.cwd, lcovPath)}; changed-line coverage was not checked. Use the Vitest preset to produce it.\n`);
      return 0;
    }
    io.stderr(`✖ No coverage report at ${lcovPath}. Run the tests with coverage first (vitest run --coverage).\n`);
    return 2;
  }
  const diffFile = option(args, '--diff-file');
  const base = option(args, '--base');
  let diffText;
  if (diffFile) diffText = await fs.readFile(path.resolve(io.cwd, diffFile), 'utf8');
  else if (base) diffText = await gitDiff(io.cwd, base);
  else {
    io.stderr('✖ Pass --base <git ref> (e.g. origin/main) or --diff-file <file>.\n');
    return 2;
  }
  const result = computeDiffCoverage(parseLcov(lcov, io.cwd), parseUnifiedDiff(diffText));
  if (result.percent >= min) {
    io.stdout(`✔ Changed-line coverage ${result.percent}% (${result.covered}/${result.total}), minimum ${min}%\n`);
    return 0;
  }
  io.stderr(`✖ Changed-line coverage ${result.percent}% (${result.covered}/${result.total}) is below ${min}%. Untested changed lines:\n`);
  for (const entry of result.uncovered) io.stderr(`  ${formatUncovered(entry)}\n`);
  io.stderr('\nWrite tests that exercise these lines.\n');
  return 1;
});
