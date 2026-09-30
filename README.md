# engineering-standards

**One place for the rules every project must follow: security, architecture, tests and AI-agent instructions.**
Projects connect to it once with a setup wizard. From then on, checks run automatically before every commit and on
every pull request, and improvements you make here reach every project as a normal update.

> **Why this exists.** Writing rules into a project's `AGENTS.md` is not enough. AI agents (and people) read them,
> then take shortcuts anyway, and nothing notices. Here, the rules are **checked by machines**: if code breaks a rule,
> the commit or the pull request fails.

---

## Contents

1. [How it works](#1-how-it-works): [under the hood](#11-under-the-hood-the-three-delivery-channels) · [step by step](#12-what-actually-runs-step-by-step) · [words used](#13-words-used-in-this-readme)
2. [Quick start: new project](#2-quick-start-new-project)
3. [Quick start: existing project](#3-quick-start-existing-project)
4. [Make the checks mandatory on GitHub](#4-make-the-checks-mandatory-on-github)
5. [What happens when](#5-what-happens-when)
6. [A check failed. What now?](#6-a-check-failed-what-now)
7. [Changing the rules](#7-changing-the-rules-and-how-projects-get-them)
8. [Improving the standards from another project](#8-improving-the-standards-from-another-project-harvest)
9. [AI tools and skills](#9-ai-tools-and-skills)
10. [All commands](#10-all-commands)
11. [FAQ](#11-faq)

---

## 1. How it works

```
                 ┌───────────────────────────────────────────┐
                 │   engineering-standards (this repo)        │
                 │   rules · checks · CI pipelines · wizard   │
                 │   released as versions: v1.0.0, v1.1.0 …   │
                 └───────────────┬───────────────▲────────────┘
     ① wizard connects a project │               │ ③ good ideas from a project
     ② updates arrive as PRs     │               │   are brought back here ("harvest")
                                 ▼               │
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │  Project A   │  │  Project B   │  │  Project C   │
          └──────────────┘  └──────────────┘  └──────────────┘
```

- **This repo** holds the rules. It knows nothing about your projects.
- **A project** only stores *which version* of the rules it uses (one line in `package.json`), plus a few tiny files
  that say "use the shared rules". The wizard creates those files for you.
- **Updates** travel one way, from here to the projects. You change a rule here and release a new version.
  Dependabot then opens a pull request in each project, and that project's CI shows whether it still passes.
- **Project-specific rules** stay in the project. They are added *next to* the shared ones, never mixed in.

### 1.1 Under the hood: the three delivery channels

This repo reaches a project through **three separate channels**. Once you know them, everything else follows.

```
 engineering-standards (GitHub)                        your project
 ─────────────────────────────                        ────────────────────────────────────────────
 ① npm package  @oneup4real/standards   ── npm install ──▶  node_modules/@oneup4real/standards/
    (code: CLI, wizard, checks, configs)                     + one line in package.json
                                                             + exact commit pinned in package-lock.json

 ② reusable CI workflows                ◀── fetched by GitHub ── .github/workflows/ci.yml
    .github/workflows/ci-node.yml             on every run        ("uses: …/ci-node.yml@v1")
    .github/workflows/security.yml

 ③ small files written ONCE by the wizard ─────────────▶  eslint.config.mjs, .husky/pre-commit,
    (they only point to ① and ②)                             AGENTS.md block, .standardsrc.json …
```

**① The npm package** (`@oneup4real/standards`)

- **What it is:** a normal npm package, like `react`. It contains the command-line tool `oneup-standards` (wizard,
  checks, hooks), the ESLint/TypeScript/Vitest/architecture configs, and the AI rules text.
- **Where it comes from:** it is **not on the public npm registry**. npm installs it **straight from this GitHub repo**:
  ```json
  "devDependencies": { "@oneup4real/standards": "github:oneup4real/engineering-standards#semver:^1.0.0" }
  ```
  This means: "download the repo from GitHub, use the newest version tag that matches `^1.0.0`". No npm account or token
  is needed, because the repo is public.
- **Where it lands:** `node_modules/@oneup4real/standards/`. Its commands appear in `node_modules/.bin/`, so
  `npx oneup-standards …` works. `package-lock.json` records the exact commit, so every machine and CI run uses the same
  code.
- **How it updates:** only when `package.json` changes, i.e. when you merge Dependabot's "bump @oneup4real/standards"
  pull request.

**② The reusable CI workflows**

- **What they are:** GitHub Actions workflow files in *this* repo. They are **not** part of the npm package.
- **How a project uses them:** the project's own `.github/workflows/ci.yml` is only a few lines. It says
  `uses: oneup4real/engineering-standards/.github/workflows/ci-node.yml@v1`. On every run, **GitHub itself** fetches
  that file from this repo and runs its steps inside the project's CI. Those steps then call the package from ① (which
  `npm ci` installed).
- **How they update:** `@v1` is a **tag that moves** to the latest 1.x release. So CI fixes reach every project
  immediately, without a pull request. (Projects that chose "never update" point to a fixed tag such as `@v1.0.1`.)

**③ The files the wizard writes** (once)

| File in your project | Content | Points to |
|---|---|---|
| `eslint.config.mjs` | 3 lines: "use the shared rules" | ① `eslint/nextjs.js` |
| `tsconfig.json` (you add `"extends"`) | "use the strict settings" | ① `tsconfig/nextjs.json` |
| `.dependency-cruiser.cjs` | "use the layer rules" | ① `depcruise/layered.cjs` |
| `vitest.config.ts` | "use the test preset" | ① `vitest/index.js` |
| `tests/arch/standards.test.ts` | your guard names and folders | ① `arch/suite.js` |
| `.husky/pre-commit`, `.husky/pre-push` | one line: `npx --no-install oneup-standards hook …` | ① the CLI |
| `.github/workflows/ci.yml` | "run the shared pipeline" | ② |
| `.github/dependabot.yml` | weekly update PRs | keeps ① current |
| `AGENTS.md` (+ `CLAUDE.md`, `GEMINI.md`) | the shared AI rules, between markers | copied from ① (`sync-agents` refreshes it) |
| `.standardsrc.json` | project settings (bundle markers, update mode) | read by ① |
| `arch-allowlist.json`, `arch-action-gaps.json`, `.dependency-cruiser-known-violations.json` | the ratchets (existing problems) | read by ① |

Because these files only *point* to the package, a rule change needs no edits in the project: the next package
version changes the behaviour.

### 1.2 What actually runs, step by step

| You do… | Technically this happens |
|---|---|
| `npm install --save-dev github:…` | npm clones this repo at the matching tag into `node_modules`, links `oneup-standards` into `node_modules/.bin` |
| `npx oneup-standards init` | Node runs `bin/oneup-standards.js` → the wizard detects your project, asks, writes the files from ③ |
| `npm install` (any later time) | npm runs your `prepare` script → `husky` activates the hooks in `.husky/` |
| `git commit` | git runs `.husky/pre-commit` → `oneup-standards hook pre-commit` → forbidden-file check, gitleaks, lint-staged |
| `git push` | `.husky/pre-push` → TypeScript check, tests |
| open a pull request | GitHub runs your `ci.yml` → fetches `ci-node.yml@v1` and `security.yml@v1` from this repo → they run `npm ci`, then lint, tests with coverage, TDD checks, architecture rules, build, bundle check, secret and code scans |
| a new standards version is released | Dependabot changes the one line in `package.json` in a PR → that PR's CI shows if the project still passes |

### 1.3 Words used in this README

| Word | Meaning |
|---|---|
| **npm package** | A folder of code with a `package.json`, installed into `node_modules`. Here: `@oneup4real/standards`. |
| **git dependency** | An npm package installed from a git repo instead of the npm registry (`github:owner/repo#…`). |
| **tag / version** | A named point in this repo's history (`v1.0.1`). `v1` is a moving tag = "latest 1.x". |
| **CLI** | The command-line tool `oneup-standards` inside the package. |
| **wizard** | `oneup-standards init`: the interactive setup command. |
| **hook** | A script git runs automatically before a commit or push. Managed by the tool *husky*. |
| **reusable workflow** | A GitHub Actions pipeline in one repo that other repos call with `uses:`. |
| **Dependabot** | GitHub's bot that opens pull requests to update dependencies. |
| **ratchet / baseline** | A file listing today's known problems. Checks ignore those but fail on new ones; the list may only shrink. |
| **skill** | Step-by-step instructions an AI tool loads for a type of task (e.g. Superpowers `test-driven-development`). There is no skill *required* to use this repo: the wizard is a normal command anyone can run. |

## 2. Quick start: new project

```bash
npx create-next-app@latest my-app      # or create your project any other way
cd my-app
git init
npm install --save-dev github:oneup4real/engineering-standards#semver:^1.0.0
npx oneup-standards init               # the wizard: explains each step and asks
```

Then follow [section 4](#4-make-the-checks-mandatory-on-github).

## 3. Quick start: existing project

Run these inside the project folder, one after the other.

**Step 1: add the standards package**
```bash
npm install --save-dev github:oneup4real/engineering-standards#semver:^1.0.0
```
✔ Expected: `added … packages`. `package.json` now lists `@oneup4real/standards`.

**Step 2: run the wizard**
```bash
npx oneup-standards init
```
It asks up to 8 short questions and explains each one. Pressing Enter picks the recommended answer.
Your existing files are **never silently replaced**:

| You already have… | The wizard… |
|---|---|
| `eslint.config.mjs` | asks: **merge** (keeps yours as `eslint.config.local.mjs`), replace, or skip |
| `.github/workflows/ci.yml` | asks: replace or keep |
| `AGENTS.md` | adds the shared rules as a marked block at the end; your text stays byte for byte |
| `CLAUDE.md` with `@AGENTS.md` | leaves it alone |
| a PR template, `tests/arch/…`, a test script | keeps them |

✔ Expected at the end: a **Summary** table listing every file as `created`, `merged`, `skipped` or `updated`.

**Step 3: install gitleaks** (a secret scanner; the commit hook refuses to commit without it)
```bash
brew install gitleaks          # Windows: winget install gitleaks
```

**Step 4: tell the bundle check what must never reach the browser**

Open `.standardsrc.json` and list strings that only appear in confidential data, e.g. internal IDs:
```json
{
  "bundleForbiddenMarkers": ["CUST-", "INTERNAL-REF-"],
  "bundleDir": ".next/static",
  "updateMode": "review",
  "checkFiles": { "ignore": ["templates/*.docx", "docs/**/*.pdf"] }
}
```

Then switch the check on in `.github/workflows/ci.yml`: `bundle-check: true`. (The wizard does both if you enter
markers when it asks.)

**Step 5: record the problems that already exist** (the wizard already did this if you answered yes)
```bash
npx oneup-standards baseline
```
This writes `.dependency-cruiser-known-violations.json`. **From now on only new violations fail.** Fix old ones
over time; the file should only ever shrink.

**Step 6: adjust `tests/arch/standards.test.ts`**

Set the names of your auth guard functions (e.g. `requireAuth|requireRole`) and your folders.

**Step 6b (optional): strict TypeScript settings**

The wizard does not touch `tsconfig.json`, because stricter settings can turn existing code red. When you are ready,
add `"extends": "@oneup4real/standards/tsconfig/nextjs.json"` at the top of `tsconfig.json`, run `npx tsc --noEmit` and
fix what it reports.

**Step 7: commit and push**
```bash
git add -A
git commit -m "chore: adopt engineering-standards"
git push
```
✔ Expected: the pre-commit hook prints its checks, and the push starts the **CI** and **security** jobs on GitHub.

Then continue with section 4.

## 4. Make the checks mandatory on GitHub

Without this, a red check is only a warning and anyone can still merge.

**Branch ruleset:** repository → **Settings → Rules → Rulesets → New branch ruleset**
- Target: default branch
- ✅ Restrict deletions · ✅ Block force pushes · ✅ Require a pull request before merging
- ✅ Require status checks to pass: `ci / ci`, `security / gitleaks`, `security / audit`
  (plus `security / semgrep` or `security / codeql`, whichever you use)

**Secret scanning:** **Settings → Code security** → enable *Secret scanning* and *Push protection*.

> **Private repositories on a free personal account:** rulesets, secret scanning and CodeQL need **GitHub Pro**
> (≈ $4/month) or Advanced Security. Without it the local hooks and CI still run, and they still fail
> visibly, but GitHub will not *block* the merge. That is why the wizard defaults to **Semgrep** (free) instead of CodeQL.

With the GitHub CLI installed (`brew install gh`, then `gh auth login`), the wizard can create the ruleset for you.

## 5. What happens when

| When | What runs | Stops… |
|---|---|---|
| `git commit` | forbidden files · gitleaks · ESLint on changed files | documents, `.env` files, keys, secrets, lint errors |
| `git push` | TypeScript check · unit tests | type errors, failing tests |
| Pull request (CI) | forbidden files · ESLint (warnings fail too) · TypeScript · tests **with coverage** · **tests-changed check** · **changed-line coverage ≥ 80%** · architecture rules · rules tests (optional) · build · bundle check | everything above, plus code without tests, layer violations and confidential data in the browser bundle |
| Pull request (security) | gitleaks (full history) · npm audit · Semgrep or CodeQL · dependency review | secrets, vulnerable dependencies, insecure code patterns |
| Every week | Dependabot | outdated or vulnerable dependencies, new rule versions |

## 6. A check failed. What now?

| Message | Meaning | Fix |
|---|---|---|
| `These files must not be committed` | a `.docx/.xlsx/.pdf`, `.env` or key file is staged | `git restore --staged <file>`; store it outside the repo (SharePoint, secret manager) |
| `gitleaks found a possible secret` | a password/API key is in your changes | remove it; if it was real, **rotate it** (it may already be in history) |
| `gitleaks is not installed` | the secret scanner is missing | `brew install gitleaks` |
| `UI code must not write to the database` | `setDoc/addDoc/…` in `src/app`, `components`, `hooks` or `context` | move the write into a server action → service |
| `Seed/fixture data must not be imported` | test/seed data is imported by app code and would ship to browsers | load it only in scripts or tests |
| `no-presentation-to-adapters` / `…-to-services` | UI imports server code directly | call a server action instead |
| `domain-is-pure` | `src/domain` imports framework, DB or UI code | move that code out of the domain |
| `exported action "x" has no guard call` | a server action doesn't check who is calling | call your guard (`requireAuth()`…) first, or mark it `// @public-action: <reason>` and rate-limit it |
| `missing import 'server-only'` | a `src/server` file could end up in the browser | add `import 'server-only';` as the first line |
| `direct call(s) … allowed N` | new direct DB writes outside server code | move them behind a server action |
| `shrink the entry in arch-allowlist.json` | you removed old writes, good! | lower the number in the file (the ratchet only goes down) |
| `Confidential data found in the client bundle` | a marker from `.standardsrc.json` is in built JS | find the `src/` import that pulls that data in and move it server-side |
| `Build directory … does not exist` | bundle check ran before the build | run `npm run build` first |
| `Source code changed, but no test file changed` | the PR changes code in `src/` (or `app/`, `lib/` …) without touching any test | write the test (first!). Only if truly no test is needed: label the PR `no-tests-needed` and explain why |
| `Changed-line coverage … is below 80%` | tests don't run the lines you changed | add tests for the listed lines (`file: 12, 15-18`) |
| `Coverage for lines (…%) does not meet … threshold` | `src/domain` is below 90% covered | add unit tests for the pure domain logic |

**Never** "fix" a check by disabling it, adding an ignore comment, growing a baseline or using `git commit --no-verify`.

## 7. Changing the rules (and how projects get them)

1. Change the rule here, with a test (`npm test`), and update `CHANGELOG.md`.
2. Release a version:
   ```bash
   npm version minor           # e.g. 1.0.0 → 1.1.0 (use "major" for changes that may break projects)
   git push --follow-tags
   git tag -f v1 && git push -f origin v1   # moves the v1 pointer used by the CI workflows
   ```
3. Dependabot opens "bump @oneup4real/standards to 1.1.0" in every project, and each project's CI shows whether it
   still passes. Merge it (or let it auto-merge, if the project chose `updateMode: auto`).

## 8. Improving the standards from another project ("harvest")

When a project has a good security or architecture practice:

1. Check it is useful for **every** project (otherwise keep it local).
2. Make it generic: no project names, customer data or hard-coded paths; turn values into options.
3. Add it here with tests, then release a new version (section 7).

**Never copy confidential details into this repo.** It is public.

## 9. AI tools and skills

**Which file each tool reads:**

| Tool | Reads | Set up by |
|---|---|---|
| Codex, Cursor, Copilot, Jules, Antigravity | `AGENTS.md` | wizard / `sync-agents` |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | wizard / `sync-agents` |
| Gemini CLI | `GEMINI.md` → `@AGENTS.md` | wizard / `sync-agents` |
| All tools, every project (global) | `~/.agents/AGENTS.md` (+ pointers in `~/.claude`, `~/.gemini`, copy in `~/.codex`) | `npx oneup-standards sync-agents --global` |

The shared rules live in [`agents/AGENTS.global.md`](agents/AGENTS.global.md). In a project they sit between
`<!-- BEGIN oneup4real/engineering-standards … -->` and `<!-- END … -->`. Don't edit inside the markers; the next
sync overwrites it. Write project rules outside the block.

### Subagent Dual-Control Workflow & Superpowers

The setup wizard automatically checks if Claude Code is installed and offers to install the **Superpowers** plugin (`superpowers@superpowers-marketplace`).

Superpowers powers the **Subagent Dual-Control Protocol** specified in `AGENTS.global.md`:
1. **Planning:** Breaks tasks into atomized steps with test and acceptance criteria (`writing-plans`).
2. **Implementer Subagents:** Dispatches dedicated, isolated implementers per task (`executing-plans` / `subagent-driven-development`).
3. **Reviewer Subagents (Dual Control):** Spawns an independent reviewer after each step to verify code, types, architecture, and tests before moving forward.

**Installation & Manual Setup:**
```bash
claude plugin install superpowers@superpowers-marketplace
```

**Superpowers skills** (process discipline, installed as a Claude Code plugin: `superpowers@superpowers-marketplace`):

| Situation | Skill |
|---|---|
| New feature or behaviour change: clarify before coding | `brainstorming` |
| Multi-step task: plan files, signatures and tests first | `writing-plans` |
| Carry out a plan task by task | `executing-plans` / `subagent-driven-development` |
| Any code: test first, see it fail, then implement | `test-driven-development` |
| Bug or failing test: prove the root cause first | `systematic-debugging` |
| Before saying "done": run the checks, show the output | `verification-before-completion` |
| Review before merge | `requesting-code-review` / `receiving-code-review` |

Tools without skill support get the short version of these steps from `AGENTS.md` section 1.

### How test-driven development (TDD) is enforced

| Part of TDD | Enforced by |
|---|---|
| Tests exist and pass | pre-push hook and CI (`vitest run --coverage`) |
| New code comes with tests | CI `check-tests-changed`: a PR that changes source code without any test change fails |
| The new code is actually tested | CI `check-diff-coverage`: at least 80% of the **changed lines** must be run by tests. Works in old projects with low overall coverage too |
| Core logic is thoroughly tested | Vitest preset: `src/domain` needs ≥ 90% lines/functions, ≥ 80% branches |
| The test was written **first** and seen failing | cannot be checked by a machine: AGENTS.md rule, Superpowers `test-driven-development`, PR checkbox |

Escape hatch: label a pull request `no-tests-needed` (e.g. a pure copy change) and say why. AI agents are told never to
add that label themselves.

**Remember:** instructions are the soft layer. The hooks and CI are what actually hold the line, whichever AI (or
human) wrote the code.

## 10. All commands

| Command | What it does |
|---|---|
| `npx oneup-standards init` | setup wizard (`--yes` = accept all recommended answers) |
| `npx oneup-standards baseline` | record current architecture violations (only new ones fail afterwards) |
| `npx oneup-standards sync-agents` | refresh the shared rules in `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` |
| `npx oneup-standards sync-agents --global` | same, for your personal global AI instructions |
| `npx oneup-standards check-files [paths]` | forbidden-file check (default: staged files) |
| `npx oneup-standards check-bundle [--dir d]` | scan built client JS for confidential markers |
| `npx oneup-standards check-tests-changed --base origin/main` | fail if source changed without test changes |
| `npx oneup-standards check-diff-coverage --base origin/main [--min 80]` | fail if changed lines are under-tested (needs `coverage/lcov.info`) |
| `npx oneup-standards hook pre-commit` / `pre-push` | what the git hooks run |

**Building blocks you can import:**

| Import | Use |
|---|---|
| `@oneup4real/standards/eslint/nextjs` · `/eslint/base` | ESLint presets |
| `@oneup4real/standards/tsconfig/nextjs.json` · `/tsconfig/base.json` | `"extends"` in `tsconfig.json` |
| `@oneup4real/standards/depcruise/layered` | architecture rules for dependency-cruiser |
| `@oneup4real/standards/vitest` | `defineStandardsConfig()` for `vitest.config.ts` |
| `@oneup4real/standards/arch/suite` | `defineArchSuite()`: server-only, action guards, write ratchet, sets in sync |
| `@oneup4real/standards/firebase-testing` | `assertEmulator`, `createRulesEnv`, `nobody`, `anon`, `withRoles`, `seed` |
| `@oneup4real/standards/next/headers` | `securityHeaders()` for `next.config`. Firebase apps: `securityHeaders({ firebase: true })` |

More detail: [docs/architecture.md](docs/architecture.md) · [docs/adoption.md](docs/adoption.md)

## 11. FAQ

**Is this an npm package?** Yes: `@oneup4real/standards`. It is installed from this GitHub repo, not from the npm
registry (see [1.1](#11-under-the-hood-the-three-delivery-channels)).

**Is "connecting a project" a skill I need?** No. Connecting = installing the package and running `npx oneup-standards init`.
You can do it yourself, or ask any AI assistant to run those two commands. (A skill that wraps them may come later.)

**Does connecting a project change anything in this repo?** No. Projects only read from here.

**Can a project stay on an old version?** Yes. Don't merge the update PR, or choose "Never update" in the wizard.
With "review" or "auto", the CI workflows follow the `v1` tag, so CI fixes arrive without a PR (only compatible
changes are ever released under `v1`). "Never update" pins CI to the exact release (e.g. `@v1.0.0`) as well.

**The wizard replaced something I needed.** It only replaces files after you answered "replace". Your previous ESLint
config is kept as `eslint.config.local.mjs`. Everything is in git: `git diff` shows the changes, and `git checkout -- <file>`
restores a file.

**CI says `npx oneup-standards: not found`.** Run `npm install` and commit `package-lock.json`.

**My project doesn't use Next.js.** Use `eslint/base` and `tsconfig/base.json`. The rest works the same.

**Can I run the wizard again?** Yes. It detects what is already there and only fills the gaps.
