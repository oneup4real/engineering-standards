# Engineering Standards Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local repo `~/Documents/engineering-standards`, shipping the package `@oneup4real/standards`: shared configs, security checks, agent-instruction sync, a project initializer and reusable GitHub workflows.

**Architecture:** A single npm package lives at the repo root. It is plain ESM JavaScript with JSDoc types and no build step, so consumers can install it straight from a git tag. The logic is written as pure functions in `lib/`, each covered by Vitest. A thin CLI, `bin/oneup-standards.js`, dispatches subcommands to those functions. The configs live under `eslint/`, `tsconfig/`, `depcruise/` and `vitest/`, and are consumed through `exports` subpaths. The GitHub workflows live under `.github/workflows/` and are exposed via `workflow_call`.

**Tech Stack:** Node 22, ESLint 9 flat config, typescript-eslint 8, dependency-cruiser 16, Vitest 3, Husky 9, lint-staged 15, gitleaks (CLI + action), CodeQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-engineering-standards-design.md`

## Global Constraints

- Package name `@oneup4real/standards`, `"type": "module"`, `"engines": { "node": ">=22" }`, no build step.
- CLI binary name: `oneup-standards`.
- Managed-block markers, copied verbatim: `<!-- BEGIN oneup4real/engineering-standards (managed, do not edit) -->` and `<!-- END oneup4real/engineering-standards -->`.
- Forbidden file extensions (case-insensitive): `.docx .doc .xlsx .xls .pptx .pdf .pem .p12 .pfx .key`. Forbidden basenames: `.env` and `.env.*`, except `.env.example`. Also forbidden: any JSON file whose basename matches `/service[-_]?account.*\.json$/i`.
- Consumer dependency spec: `"@oneup4real/standards": "github:oneup4real/engineering-standards#semver:^1.0.0"`.
- Reusable workflow refs: `oneup4real/engineering-standards/.github/workflows/ci-node.yml@v1` and `…/security.yml@v1`.
- Every third-party action is pinned to a full commit SHA with a `# vX.Y.Z` comment. Every workflow declares least-privilege `permissions:`.
- The CLI never overwrites an existing consumer file unless it is given `--force`. It never writes outside the target directory, except `sync-agents --global`, which writes only the four global files named in Task 3.
- Nothing is pushed to GitHub in this plan.

## Review Focus

1. **An existing AGENTS.md without markers** (ISMS-GUARDIAN has 190 hand-written lines). The sync must append the managed block and preserve every existing byte. It must never replace the file. → Task 3 test `appends block when markers absent and preserves content`.
2. **Running `init` on a repo that already has `eslint.config.mjs` or `ci.yml`.** Those files must be reported as `skipped`, never silently replaced. → Task 8 test `skips existing files when answer is skip`.
3. **Forbidden paths with uppercase or spaces**, such as `01 PROCEDURES/Plan.DOCX`. They must be caught. `.env.example` must still pass. → Task 2 tests.
4. **`check-bundle` on a missing or empty build directory.** It must fail with exit code 2, not pass silently. → Task 4 test `throws when directory missing`.
5. **gitleaks not installed locally.** The pre-commit hook must fail with an install hint and must not skip the scan. → Task 7 test `pre-commit fails with hint when gitleaks missing`.

---

### Task 1: Repo skeleton and self-CI

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc` (`22`), `vitest.config.js`, `bin/oneup-standards.js`, `lib/cli.js`, `test/cli.test.js`, `.github/workflows/self-ci.yml`, `LICENSE` (MIT)

**Interfaces:**
- Produces: `runCli(argv: string[], io: { cwd: string, stdout: (s:string)=>void, stderr: (s:string)=>void, env: Record<string,string|undefined> }): Promise<number>` in `lib/cli.js`. It returns the exit code. Later tasks register subcommands in its `commands` map, `Record<string, (args: string[], io) => Promise<number>>`.
- `package.json` `exports`: `"./eslint/base"`, `"./eslint/nextjs"`, `"./depcruise/layered"`, `"./vitest"`, `"./tsconfig/base.json"`, `"./tsconfig/nextjs.json"`, `"./package.json"`.
- `package.json` `dependencies`: `typescript-eslint`, `@eslint/js`, `globals`, `dependency-cruiser`, `lint-staged`. `peerDependencies`: `eslint ^9`, `typescript ^5`, `vitest ^3`, `eslint-config-next` (optional via `peerDependenciesMeta`). `devDependencies`: `vitest`, `@vitest/coverage-v8`, `eslint`, `typescript`.

- [ ] **Step 1: Write failing test** `test/cli.test.js`
  - `unknown command prints usage and returns 2`: `runCli(['nope'], io)` resolves `2`, and stderr contains `Usage: oneup-standards <command>`.
  - `no args prints usage and returns 2`.
- [ ] **Step 2: Run** `npx vitest run test/cli.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `runCli` with an empty `commands` map. `bin/oneup-standards.js` calls `process.exit(await runCli(process.argv.slice(2), {cwd: process.cwd(), stdout: s=>process.stdout.write(s), stderr: s=>process.stderr.write(s), env: process.env}))`. Add `"bin": {"oneup-standards": "bin/oneup-standards.js"}` and `"scripts": {"test": "vitest run", "lint": "eslint ."}`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Write `self-ci.yml`.** Trigger on push/PR to `main`, with `permissions: contents: read`. Steps: checkout, setup-node 22 with npm cache, `npm ci`, `npm test`, then `rhysd/actionlint` over `.github/workflows/`. Resolve action SHAs with `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>`.
- [ ] **Step 6: Commit** `chore: scaffold @oneup4real/standards package and self-CI`

### Task 2: Forbidden-file check

**Files:** Create `lib/forbidden-files.js`, `test/forbidden-files.test.js`. Modify `lib/cli.js` to register `check-files`.

**Interfaces:**
- Produces: `findForbiddenFiles(paths: string[]): { path: string, reason: string }[]`
- CLI: `oneup-standards check-files [paths...]`. With no paths it uses `git diff --cached --name-only --diff-filter=ACMR -z`. It exits `1` and lists each offender with its reason when anything is found, and `0` otherwise.

- [ ] **Step 1: Write failing tests**
  - `flags office documents regardless of case and spaces`: `['01 PROCEDURES/Plan.DOCX','a/b.xlsx','r.pdf']` → 3 results, and `reason` includes `confidential document`.
  - `flags env files but allows .env.example`: `['.env','.env.local','app/.env.production','.env.example']` → exactly the first 3.
  - `flags key material and service accounts`: `['k.pem','c.p12','sa/serviceAccount-prod.json','service_account.json']` → 4.
  - `allows normal source`: `['src/a.ts','package.json','README.md','environment.ts']` → `[]`.
  - `check-files exits 1 and names offender` (through `runCli(['check-files','x.docx'], io)`).
- [ ] **Step 2: Run** `npx vitest run test/forbidden-files.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** using the Global Constraints lists. Match on `path.posix.basename(p).toLowerCase()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add forbidden-file check for documents, env files and key material`

### Task 3: Agent instructions and sync-agents

**Files:** Create `lib/managed-block.js`, `lib/sync-agents.js`, `agents/AGENTS.global.md`, `agents/AGENTS.project.md`, `test/managed-block.test.js`, `test/sync-agents.test.js`. Modify `lib/cli.js`.

**Interfaces:**
- Produces: `upsertManagedBlock(existing: string | null, block: string): string`
- Produces: `syncAgents(opts: { targetDir: string, global: boolean, homeDir: string, force?: boolean }): Promise<{ file: string, action: 'created'|'updated'|'unchanged'|'skipped' }[]>`
- CLI: `oneup-standards sync-agents [--global]`

- [ ] **Step 1: Write failing tests** for `upsertManagedBlock`
  - `creates file content when existing is null`: the result equals `BEGIN\n<block>\nEND\n`, using the exact markers.
  - `appends block when markers absent and preserves content`: the input `'# My Project\n\nCustom rule.\n'` is a strict prefix of the result.
  - `replaces only the block when markers present`: text before and after the markers is unchanged and the old block text is gone.
  - `is idempotent`: `upsert(upsert(x,b),b) === upsert(x,b)`.
  - `preserves CRLF line endings when input uses CRLF`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `upsertManagedBlock`.**
- [ ] **Step 4: Write failing tests** for `syncAgents` against a temp dir (`fs.mkdtemp`)
  - `project mode writes AGENTS.md block, CLAUDE.md and GEMINI.md`: CLAUDE.md contains `@AGENTS.md`, and GEMINI.md contains `@AGENTS.md`.
  - `project mode skips CLAUDE.md that has other content and no @AGENTS.md`: the action is `skipped`, and the file is unchanged.
  - `global mode writes ~/.agents/AGENTS.md, ~/.claude/CLAUDE.md with @~/.agents/AGENTS.md, ~/.gemini/GEMINI.md with @~/.agents/AGENTS.md, and ~/.codex/AGENTS.md containing the full block`. Use a temp `homeDir`.
  - `second run reports unchanged`.
- [ ] **Step 5: Implement `syncAgents`.** The block content is read from `agents/AGENTS.global.md` (global) or `agents/AGENTS.project.md` (project). Pointer files that already contain other content get the pointer line inside a managed block rather than being replaced.
- [ ] **Step 6: Write `agents/AGENTS.global.md`** (at most about 120 lines, tool-neutral imperative rules):
  - Workflow: brainstorm, plan, TDD, debug, and verify with command output. Say "use Superpowers skills if available".
  - Architecture: the layer table from the spec.
  - The NEVER list:
    - Never write to the DB from client code.
    - Never import seed or fixture data into `src/`.
    - **Never loosen DB security rules or permissions to fix an error; report it instead.**
    - Never put secrets in `NEXT_PUBLIC_*`.
    - Never commit documents or `.env` files.
    - Never fabricate audit, log or test evidence.
    - Never hard-code user identities.
  - The ALWAYS list:
    - Validate with Zod at the server boundary.
    - Derive identity from the verified token.
    - Write the audit entry server-side.
    - Allow only `https:` URLs for user-supplied links.
  - Definition of Done: `npm run lint`, `tsc --noEmit`, `npm test`, `depcruise`, `npm run build`, `oneup-standards check-bundle`, with output shown.
- [ ] **Step 7: Write `agents/AGENTS.project.md`.** It holds the global rules plus a `## Current state vs. target` section containing an explicit placeholder table (Area | Current | Target | Tracking issue), with the instruction "Agents: treat Target as not yet built unless Current says otherwise".
- [ ] **Step 8: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 9: Commit** `feat: add canonical AGENTS.md content and multi-tool sync-agents`

### Task 4: Bundle check

**Files:** Create `lib/bundle-check.js`, `test/bundle-check.test.js`. Modify `lib/cli.js`.

**Interfaces:**
- Produces: `scanForMarkers(files: { path: string, content: string }[], markers: string[]): { path: string, marker: string }[]`
- Produces: `checkBundle(opts: { dir: string, markers: string[] }): Promise<{ path: string, marker: string }[]>`. Throws `BundleDirError` if `dir` is missing or contains no `.js` files.
- CLI: `oneup-standards check-bundle [--dir .next/static]`. Markers come from `.standardsrc.json` `bundleForbiddenMarkers` (string[]). Exit codes: `0` clean, `1` markers found, `2` bad dir or no config.

- [ ] **Step 1: Write failing tests**
  - `finds marker in file`
  - `returns empty when clean`
  - `throws when directory missing`
  - `throws when directory has no js files`
  - `CLI exits 2 without markers configured`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Walk the directory recursively, reading only `.js` files.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add client bundle check for confidential markers`

### Task 5: Shared lint, type and architecture configs

**Files:**
- Create: `tsconfig/base.json`, `tsconfig/nextjs.json`, `eslint/base.js`, `eslint/nextjs.js`, `depcruise/layered.cjs`
- Create test fixtures: `test/fixtures/layered/src/{app,domain,server/adapters,shared}/*.ts`
- Create tests: `test/eslint-config.test.js`, `test/depcruise.test.js`

**Interfaces:**
- `eslint/base.js` default-exports a flat-config array. `eslint/nextjs.js` default-exports `[...base, ...nextVitals, ...nextTs, securityRules]`, where `eslint-config-next` is imported dynamically and skipped with a console warning if it isn't installed.
- `depcruise/layered.cjs` exports `{ forbidden, options }` with these rule names: `no-presentation-to-adapters`, `domain-is-pure`, `no-circular`, `not-to-unresolvable`.
- `tsconfig/base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `skipLibCheck`. `nextjs.json` extends base and adds the Next settings (`jsx: preserve`, `module: esnext`, `moduleResolution: bundler`, `plugins: [{name: "next"}]`).

- [ ] **Step 1: Write failing ESLint tests.** Use `new ESLint({ overrideConfigFile: true, overrideConfig: securityRulesOnly })` and `lintText(code, { filePath })`.
  - `blocks firestore writes in src/app`: `import { setDoc } from 'firebase/firestore'` at `src/app/page.tsx` produces an error from `no-restricted-imports`.
  - `allows firestore reads in src/app`: `import { getDocs } …` produces no error.
  - `allows firestore writes in src/server/adapters`.
  - `blocks seed-data import in src`: `import s from '@/lib/seed-data.json'` produces an error.
  - `blocks dangerouslySetInnerHTML`.
  - `blocks NEXT_PUBLIC secret names`: `process.env.NEXT_PUBLIC_API_TOKEN` produces an error. `process.env.NEXT_PUBLIC_FIREBASE_API_KEY` is allowed.
  - `no-explicit-any is error`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Export `securityRules` as a named export from `eslint/nextjs.js` so the tests can use it without `eslint-config-next`.
- [ ] **Step 4: Write failing depcruise tests.** Use `cruise(['test/fixtures/layered/src'], layered.options-derived config)` from the `dependency-cruiser` API.
  - `flags app → server/adapters` (rule `no-presentation-to-adapters`)
  - `flags domain → app` (rule `domain-is-pure`)
  - `allows domain → shared`
- [ ] **Step 5: Implement `depcruise/layered.cjs`.** Presentation is `^src/(app|components|hooks|context)/`. Domain may import only `^src/(domain|shared)/`.
- [ ] **Step 6: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: add shared tsconfig, eslint security preset and layered depcruise rules`

### Task 6: Vitest preset

**Files:** Create `vitest/index.js`, `test/vitest-preset.test.js`.

**Interfaces:**
- Produces: `defineStandardsConfig(overrides?: import('vitest/config').UserConfig): UserConfig`. It deep-merges the overrides over these defaults:
  - `test.include`: `['src/**/*.test.{ts,tsx}']`
  - `test.coverage.provider`: `'v8'`
  - `test.coverage.thresholds`: `{ 'src/domain/**': { lines: 90, functions: 90, branches: 80 } }`
  - `test.coverage.reporter`: `['text','json-summary']`

- [ ] **Step 1: Write failing tests**
  - `defaults include domain thresholds`
  - `overrides merge without dropping defaults`: overriding `test.coverage.thresholds.lines = 50` keeps the `src/domain/**` threshold.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with a small local `deepMerge` (arrays are replaced, not concatenated).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add vitest preset with domain coverage thresholds`

### Task 7: Git hook commands

**Files:** Create `lib/hooks.js`, `test/hooks.test.js`. Modify `lib/cli.js`.

**Interfaces:**
- Produces: `preCommit(io, deps: { exec: (cmd: string, args: string[]) => Promise<{code:number, stdout:string, stderr:string}>, which: (bin:string)=>Promise<boolean> }): Promise<number>`. It runs, in order: `check-files` on staged paths; `gitleaks protect --staged --redact --no-banner`; `npx lint-staged`. It stops at the first failure.
- Produces: `prePush(io, deps): Promise<number>`. It runs `npx tsc --noEmit`, then `npm test --silent`.
- CLI: `oneup-standards hook pre-commit`, `oneup-standards hook pre-push`.

- [ ] **Step 1: Write failing tests** (with fake `exec` and `which`)
  - `pre-commit fails with hint when gitleaks missing`: returns `1`, and stderr contains `brew install gitleaks`.
  - `pre-commit stops at forbidden file before running gitleaks`.
  - `pre-commit runs gitleaks then lint-staged when clean`: asserts the order of the recorded exec calls.
  - `pre-push returns non-zero when tsc fails`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The real `deps` use `node:child_process` `spawn` with `stdio: 'inherit'`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add pre-commit and pre-push hook commands`

### Task 8: Interactive setup wizard and baseline

**Files:** Create `lib/detect.js`, `lib/wizard.js`, `lib/init.js`, `templates/consumer/*` (list below), `test/detect.test.js`, `test/init.test.js`, `test/wizard.test.js`. Modify `lib/cli.js`.

**Templates** (`{{name}}` replaced by the package.json name):
- `eslint.config.mjs`: re-exports `@oneup4real/standards/eslint/nextjs`
- `eslint.config.merge.mjs`: used for "merge"; spreads the shared config and then imports the project's previous config, saved as `eslint.config.local.mjs`
- `.dependency-cruiser.cjs`: requires `@oneup4real/standards/depcruise/layered` and honours `.dependency-cruiser-known-violations.json`
- `vitest.config.ts`: `defineStandardsConfig()`
- `.github/workflows/ci.yml`: calls both reusable workflows `@v1`
- `.github/dependabot.yml`: npm and github-actions, weekly, grouped
- `.github/workflows/standards-automerge.yml`: only written when the update mode is `auto`
- `.husky/pre-commit`, `.husky/pre-push`
- `.standardsrc.json`: `{ "bundleForbiddenMarkers": [], "bundleDir": ".next/static", "updateMode": "review" }`
- `.lintstagedrc.json`

**Interfaces:**
- Produces: `detectProject(dir: string): Promise<{ isEmpty: boolean, name: string|null, framework: 'nextjs'|'node'|'unknown', usesFirebase: boolean, githubRemote: string|null, existing: string[] }>`. `existing` lists which template target paths already exist.
- Produces: `initProject(opts: { targetDir: string, answers: Answers }): Promise<{ file: string, action: 'created'|'skipped'|'overwritten'|'merged' }[]>`, where
  `Answers = { eslint: 'replace'|'merge'|'skip', ci: 'replace'|'skip', agents: boolean, updateMode: 'review'|'auto'|'never', hooks: boolean }`.
  - `updateMode: 'never'` removes nothing, but writes `"updateMode":"never"` and makes Dependabot ignore `@oneup4real/standards`.
  - It also appends missing forbidden patterns to `.gitignore` and calls `syncAgents` when `answers.agents` is set.
- Produces: `runWizard(io, deps: { prompt: (q: Question) => Promise<string|boolean>, exec, which, detect }): Promise<number>`. `Question = { id: string, message: string, explain: string, choices?: {value:string,label:string}[], default: string|boolean }`. The flow has 7 steps, each explaining what the step does before it asks:
  1. ESLint
  2. Architecture (reports the violation count and offers the baseline)
  3. Git hooks (offers `brew install gitleaks` if it's missing)
  4. CI
  5. AI agent files
  6. Update mode
  7. GitHub protection (only if `gh` exists and a GitHub remote exists; applies a ruleset via `gh api` after an explicit yes)

  It ends by printing a summary table and the next commands.
- Produces: `writeBaseline(opts: { targetDir: string, exec }): Promise<number>`
- CLI: `oneup-standards init` runs the wizard. `init --yes` accepts the recommended defaults non-interactively, for CI and agents. `oneup-standards baseline` writes the baseline. Prompts use `node:readline/promises`, with no extra dependency.

- [ ] **Step 1: Write failing tests**
  - `detect finds nextjs, firebase, remote and existing files` (fixture dir with `package.json` deps `next` and `firebase`, `.git/config` with a remote URL, and an existing `eslint.config.mjs`)
  - `detect reports empty dir`
  - `creates all template files in empty repo`
  - `skips existing files when answer is skip`: content unchanged, action `skipped`
  - `merge keeps previous eslint config as eslint.config.local.mjs`
  - `never writes outside targetDir`
  - `appends missing gitignore patterns once`
  - `updateMode never makes dependabot ignore the standards package`
  - `wizard --yes uses recommended defaults and never calls gh without consent`: the fake `exec` records no `gh` call
  - `wizard explains each step before asking`: every `prompt` call has a non-empty `explain`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add interactive setup wizard and baseline command`

### Task 9: Reusable workflows

**Files:** Create `.github/workflows/ci-node.yml`, `.github/workflows/security.yml`, `.github/dependabot.yml` (for this repo). Modify `self-ci.yml` to also call both reusable workflows against the repo itself, as dogfooding with `run-build: false`.

**Interfaces** (`workflow_call` inputs):
- `ci-node.yml`:
  - `node-version` (string, default `'22'`)
  - `run-build` (boolean, default `true`)
  - `build-command` (default `'npm run build'`)
  - `rules-test-command` (string, default `''`, skipped when empty)
  - `bundle-check` (boolean, default `true`)
  - Job id: `ci`. `permissions: contents: read`.
  - Steps: checkout, setup-node with cache, `npm ci`, `npx eslint . --max-warnings=0` only on changed files for PRs and full otherwise (implementer may use `npm run lint` if the full run is fast enough; document the choice), `npx tsc --noEmit`, `npx vitest run --coverage`, `npx depcruise src --config .dependency-cruiser.cjs`, the rules tests, the build, `npx oneup-standards check-bundle`.
- `security.yml`:
  - `node-version`.
  - Job ids `gitleaks`, `codeql`, `audit`, `dependency-review` (the last runs only on `pull_request`).
  - Permissions per job: `contents: read`, plus `security-events: write` for codeql and `pull-requests: read` for dependency-review.
  - gitleaks uses `fetch-depth: 0` to scan full history.

- [ ] **Step 1: Write the workflows** with SHA-pinned actions: checkout, setup-node, `gitleaks/gitleaks-action`, `github/codeql-action/init` and `analyze`, `actions/dependency-review-action`.
- [ ] **Step 2: Verify** with `npx --yes @action-validator/cli .github/workflows/ci-node.yml` (repeat for each file), or `actionlint` if it's installed. Expected: no errors.
- [ ] **Step 3: Verify the reference** by confirming that the `templates/consumer/.github/workflows/ci.yml` from Task 8 uses the exact job inputs defined here. A test `test/templates.test.js` parses both YAML files with the `yaml` package (add it as a devDependency) and asserts that every `with:` key in the template exists in `on.workflow_call.inputs`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add reusable ci-node and security workflows`

### Task 10: Documentation and local release

**Files:** Create `README.md`, `docs/architecture.md`, `docs/adoption.md`, `CHANGELOG.md`.

- [ ] **Step 1: Write `docs/architecture.md`.** Include the reference layers, a mutation flow diagram (UI → server action → Zod → RBAC → service → adapter → audit), Firestore guidance (client read-only; rules tested with `@firebase/rules-unit-testing`) and data classification of the 4 buckets used in the ISMS-GUARDIAN assessment (P0–P3 plus type tags).
- [ ] **Step 2: Write `docs/adoption.md`.** Cover new projects (`init`), existing projects (`init`, `baseline`, and the ratchet approach), agent setup (`sync-agents --global`), and the exact ruleset settings to enable on GitHub (require `ci / ci`, `security / gitleaks`, `security / codeql`, `security / audit`; block force pushes; require a PR), plus enabling secret scanning with push protection and Dependabot security updates.
- [ ] **Step 3: Write `README.md` for a beginner.** No jargon without a one-line explanation. Sections, in this order:
  1. What this is, in 3 sentences.
  2. How it works, with a diagram: central repo → projects (versions) and projects → central repo (harvest).
  3. Quick start: new project.
  4. Quick start: existing project, as numbered copy-paste steps with the expected output of each.
  5. What happens on commit, push and PR, as a table.
  6. What to do when a check fails, as a table: message → meaning → fix.
  7. Updating the rules centrally and how projects receive them.
  8. Improving the standards from another project (harvest).
  9. AI tools and skills: which file each tool reads, and the Superpowers skills (brainstorming, writing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review), with when each is used.
  10. FAQ.
- [ ] **Step 4: Run the full verification.** Run `npm test`, `npx eslint .`, and `node bin/oneup-standards.js check-files $(git ls-files)`. Expected: all pass, and `check-files` reports no offenders.
- [ ] **Step 5: Commit and tag locally.** Commit as `docs: add architecture, adoption guide and README`, then run `git tag v1.0.0` and `git tag v1`. Do not push. Pushing waits for the user's review.
