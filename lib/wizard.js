// Interactive setup wizard: explains each step, asks, then connects the project to @oneup4real/standards.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject } from './detect.js';
import { initProject, writeBaseline, RECOMMENDED_ANSWERS } from './init.js';

/**
 * @typedef {{ id: string, message: string, explain: string, choices?: { value: string, label: string }[], default: string | boolean }} Question
 * @typedef {{
 *   prompt: (q: Question) => Promise<string | boolean>,
 *   exec: (cmd: string, args: string[]) => Promise<{ code: number }>,
 *   which: (bin: string) => Promise<boolean>,
 *   yes?: boolean,
 *   homeDir?: string,
 * }} WizardDeps
 */

const REQUIRED_CHECKS = ['ci / ci', 'security / gitleaks', 'security / audit'];

/**
 * @param {import('./cli.js').Io} io
 * @param {WizardDeps} deps
 * @returns {Promise<number>}
 */
export async function runWizard(io, deps) {
  const dir = io.cwd;
  const info = await detectProject(dir);
  /** @param {Question} q */
  const ask = async (q) => (deps.yes ? q.default : deps.prompt(q));
  const say = (/** @type {string} */ s) => io.stdout(`${s}\n`);

  say('\n🛡  engineering-standards setup wizard\n');
  if (info.isEmpty || !info.packageJson) {
    say('No package.json found. Create the project first (e.g. `npx create-next-app@latest`), then run this wizard inside it.');
    return 2;
  }
  say(`Detected: ${info.framework === 'nextjs' ? 'Next.js' : 'Node.js'} project "${info.name ?? path.basename(dir)}"` +
    `${info.usesFirebase ? ', Firebase' : ''}${info.githubRemote ? `, GitHub remote ${info.githubRemote}` : ''}\n`);

  const has = (/** @type {string} */ target) => info.existing.includes(target);
  /** @type {import('./init.js').Answers} */
  const answers = { ...RECOMMENDED_ANSWERS, bundleMarkers: [] };

  say('[1/8] Code rules (ESLint)');
  if (has('eslint.config.mjs')) {
    answers.eslint = /** @type {typeof answers.eslint} */ (await ask({
      id: 'eslint',
      message: 'You already have an ESLint config. What should happen to it?',
      explain: 'The shared rules block insecure patterns, e.g. database writes from UI code, seed data in the browser bundle, secrets in NEXT_PUBLIC_ variables and `any` types.',
      choices: [
        { value: 'merge', label: 'Merge: keep your rules and add the shared ones (recommended)' },
        { value: 'replace', label: 'Replace with the shared rules only' },
        { value: 'skip', label: 'Skip: leave ESLint as it is' },
      ],
      default: 'merge',
    }));
  } else {
    say('  No ESLint config yet: the shared config will be created.');
  }

  say('[2/8] Architecture rules');
  const baseline = await ask({
    id: 'baseline',
    message: 'Record existing architecture violations as "known" and only block NEW ones?',
    explain: 'Architecture rules enforce UI → server actions → services → database, and a pure domain layer. Existing projects usually break some rules; recording them lets you adopt the rules today and fix old problems step by step.',
    default: true,
  });

  const markerAnswer = /** @type {string} */ (await ask({
    id: 'markers',
    message: 'Strings that must never appear in the browser bundle (comma-separated, Enter to skip):',
    explain: 'After each build, CI scans the JavaScript sent to browsers for these strings, e.g. internal ID prefixes of confidential records (like "RISK-" or "CUST-"). Leave empty to switch the bundle check off for now; you can add them to .standardsrc.json later.',
    default: '',
  }));
  answers.bundleMarkers = String(markerAnswer).split(',').map((m) => m.trim()).filter(Boolean);

  say('[3/8] Test runner (Vitest)');
  const scripts = info.packageJson?.scripts ?? {};
  const usesVitest = Boolean(info.packageJson?.devDependencies?.vitest || info.packageJson?.dependencies?.vitest);
  const hasExistingTest = Boolean(scripts.test && !usesVitest);
  if (hasExistingTest) {
    answers.vitest = /** @type {typeof answers.vitest} */ (await ask({
      id: 'vitest',
      message: `You already have a test script ("${scripts.test}"). Migrate the test runner to Vitest?`,
      explain: 'Vitest enables pure-domain coverage thresholds (>=90%), changed-line coverage checks on pull requests, and the architecture test kit.',
      choices: [
        { value: 'migrate', label: 'Migrate to Vitest (recommended: enables coverage thresholds & arch tests)' },
        { value: 'keep', label: `Keep current runner ("${scripts.test}")` },
      ],
      default: 'migrate',
    }));
  } else if (usesVitest) {
    say('  Vitest is already configured.');
  } else {
    say('  No test runner configured yet: Vitest will be set up.');
  }

  say('[4/8] Git hooks (checks before every commit and push)');
  answers.hooks = /** @type {boolean} */ (await ask({
    id: 'hooks',
    message: 'Install the git hooks?',
    explain: 'Before each commit: block .docx/.xlsx/.pdf, .env files and keys, scan for secrets (gitleaks) and lint changed files. Before each push: typecheck and tests.',
    default: true,
  }));
  let installGitleaks = false;
  if (answers.hooks && !(await deps.which('gitleaks'))) {
    const hasBrew = await deps.which('brew');
    installGitleaks = hasBrew && /** @type {boolean} */ (await ask({
      id: 'installGitleaks',
      message: 'gitleaks is not installed. Install it now with Homebrew?',
      explain: 'The pre-commit hook needs gitleaks to scan for secrets, and it refuses to commit without it rather than skipping the scan.',
      default: false,
    }));
    if (!hasBrew) say('  ⚠ gitleaks is missing. Install it before committing: https://github.com/gitleaks/gitleaks#installing');
  }

  say('[5/8] CI pipeline on GitHub');
  if (has('.github/workflows/ci.yml')) {
    answers.ci = /** @type {typeof answers.ci} */ (await ask({
      id: 'ci',
      message: 'You already have .github/workflows/ci.yml. Replace it with the shared pipeline?',
      explain: 'The shared pipeline runs lint, typecheck, tests with coverage, architecture rules, build, bundle check and security scans on every pull request. It is maintained centrally, so improvements reach this project automatically.',
      choices: [
        { value: 'replace', label: 'Replace (recommended; copy project-specific steps into the new file afterwards)' },
        { value: 'skip', label: 'Keep my ci.yml' },
      ],
      default: 'replace',
    }));
  }
  answers.codeScanning = /** @type {typeof answers.codeScanning} */ (await ask({
    id: 'codeScanning',
    message: 'Which code scanner should CI use?',
    explain: 'GitHub CodeQL is free only for public repositories (private ones need GitHub Advanced Security). Semgrep works for private repositories at no cost.',
    choices: [
      { value: 'semgrep', label: 'Semgrep (private repository, recommended)' },
      { value: 'codeql', label: 'CodeQL (public repository or Advanced Security)' },
    ],
    default: 'semgrep',
  }));

  say('[6/8] AI agent instructions');
  answers.agents = /** @type {boolean} */ (await ask({
    id: 'agents',
    message: 'Add the shared rules to AGENTS.md and create CLAUDE.md / GEMINI.md pointers?',
    explain: 'All AI coding tools read AGENTS.md (Claude and Gemini via the pointer files). The shared rules go into a marked block; your existing text stays untouched.',
    default: true,
  }));
  let installSuperpowers = false;
  const home = deps.homeDir ?? os.homedir();
  const hasClaude = await deps.which('claude');
  const hasSuperpowers = await checkSuperpowersInstalled(home, dir);
  if (hasClaude && !hasSuperpowers) {
    installSuperpowers = /** @type {boolean} */ (await ask({
      id: 'installSuperpowers',
      message: 'Claude Code is installed, but the Superpowers plugin is missing. Install it now?',
      explain: 'Superpowers provides the skills for structured subagent development: writing plans, running implementer/reviewer loops, and systematic debugging.',
      default: true,
    }));
  } else if (!hasSuperpowers) {
    say('  ℹ Tip: For Claude Code users, install the Superpowers plugin for subagent orchestration: claude plugin install superpowers@superpowers-marketplace');
  }

  say('[7/8] Updates');
  answers.updateMode = /** @type {typeof answers.updateMode} */ (await ask({
    id: 'updateMode',
    message: 'When the central rules change, what should happen in this project?',
    explain: 'The project records which version of the rules it uses. Dependabot proposes new versions as pull requests; CI shows whether the project still passes.',
    choices: [
      { value: 'review', label: 'Open a pull request, I decide (recommended)' },
      { value: 'auto', label: 'Merge automatically when all checks pass' },
      { value: 'never', label: 'Never update (frozen)' },
    ],
    default: 'review',
  }));

  const installDeps = /** @type {boolean} */ (await ask({
    id: 'installDeps',
    message: 'Run npm install now?',
    explain: 'Installs @oneup4real/standards and the tools it needs. Without it the hooks and checks cannot run.',
    default: true,
  }));

  say('[8/8] GitHub protection (makes the checks mandatory)');
  let protection = false;
  const hasGh = await deps.which('gh');
  if (info.githubRemote && hasGh) {
    protection = deps.yes ? false : /** @type {boolean} */ (await ask({
      id: 'protection',
      message: `Create a ruleset on ${info.githubRemote} that requires pull requests and passing checks on the default branch?`,
      explain: 'Without this, a red check is only a warning and anyone can still merge. The ruleset blocks merging until CI and security checks pass, and blocks force pushes.',
      default: false,
    }));
  } else if (!info.githubRemote) {
    say('  No GitHub remote found; see "Make the checks mandatory" in the README once the project is on GitHub.');
  } else {
    say('  GitHub CLI (gh) is not installed; see "Make the checks mandatory" in the README to do this by hand (or `brew install gh`, then run the wizard again).');
  }

  // --- apply ---
  const results = await initProject({ targetDir: dir, answers, homeDir: deps.homeDir ?? os.homedir() });
  if (installGitleaks) await deps.exec('brew', ['install', 'gitleaks']);
  if (installSuperpowers) await deps.exec('claude', ['plugin', 'install', 'superpowers@superpowers-marketplace']);
  let installStatus = 'skipped';
  if (installDeps) {
    const install = await deps.exec('npm', ['install']);
    installStatus = install.code === 0 ? 'ok' : 'FAILED';
    if (install.code === 0 && baseline) await writeBaseline({ targetDir: dir, exec: deps.exec });
  }
  let protectionResult = 'not configured';
  if (protection && info.githubRemote) {
    protectionResult = await createRuleset(info.githubRemote, deps.exec);
  }

  say('\nSummary');
  for (const r of results) say(`  ${r.action.padEnd(11)} ${path.relative(dir, r.file) || r.file}${r.note ? `  (${r.note})` : ''}`);
  say(`  protection  ${protectionResult}`);
  if (installStatus === 'FAILED') say('  npm install FAILED (see the npm output above; the files were still written)');
  say('\nNext steps:');
  if (installStatus !== 'ok') say(`  npm install${baseline ? ' && npx oneup-standards baseline' : ''}`);
  else if (!baseline) say('  (optional) npx oneup-standards baseline');
  if (answers.bundleMarkers.length === 0) {
    say('  (recommended) add strings that must never reach the browser to "bundleForbiddenMarkers" in .standardsrc.json,');
    say('  then set bundle-check: true in .github/workflows/ci.yml');
  }
  say('  git add -A && git commit -m "chore: adopt engineering-standards" && git push');
  return 0;
}

/**
 * @param {string} repo owner/name
 * @param {WizardDeps['exec']} exec
 */
async function createRuleset(repo, exec) {
  const ruleset = {
    name: 'engineering-standards',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
        },
      },
    ],
  };
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'oneup-ruleset-')), 'ruleset.json');
  await fs.writeFile(file, JSON.stringify(ruleset));
  const result = await exec('gh', ['api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', file]);
  return result.code === 0
    ? `ruleset created on ${repo}`
    : 'FAILED (private repositories need GitHub Pro/Team for rulesets; see README)';
}

export async function checkSuperpowersInstalled(homeDir, projectDir) {
  try {
    const pluginsFile = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
    const data = JSON.parse(await fs.readFile(pluginsFile, 'utf8'));
    if (data.plugins && (data.plugins['superpowers@superpowers-marketplace'] || data.plugins['superpowers'])) {
      return true;
    }
  } catch {
    // not found
  }
  const hasLocalDir = await fs.access(path.join(projectDir, '.superpowers')).then(() => true, () => false);
  if (hasLocalDir) return true;
  const hasHomeDir = await fs.access(path.join(homeDir, '.superpowers')).then(() => true, () => false);
  return hasHomeDir;
}
