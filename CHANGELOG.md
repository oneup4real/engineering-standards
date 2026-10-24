# Changelog

## [1.7.3] - 2026-10-24

### Changed
- **One security pipeline.** `security.yml` is the only place for SAST and SCA. Our custom Semgrep rules (now `semgrep/standards.yml`, shipped in the package) are added to its semgrep job: a project's own `.semgrep/standards.yml` first, otherwise the file fetched from this repository at the new input `standards-ref` (default `v1`); if the fetch fails the scan continues with the registry packs.
- **Hooks, one local place per check.** `hook pre-commit` = forbidden files, gitleaks (staged), lint-staged, then SAST on staged code files with our rules when `semgrep` is installed (one `brew install semgrep` hint otherwise; report-only unless `hooks.sastBlocking`). `hook pre-push` = `tsc --noEmit`, `npm test` once, then `npm audit --omit=dev --audit-level=<hooks.auditLevel, default high>` only when `package-lock.json` changed against the upstream and the network is reachable (offline: one note; report-only unless `hooks.auditBlocking`).
- **Risk tiers:** T3 no longer starts all five reviewers. T3 = security, logic, test-quality always, ui only for UI paths, architecture only for layer/import/action paths; T2 = logic (+ architecture, test-quality, ui by path); T1 = ui; T0 = none (test-quality for guard tests now needs T2 or higher). `risk-tier`, README, `AGENTS.global.md` 1b and `factory-review` say the same.
- `doctor`: recognises `security.yml` usage (`semgrep`/`codeql` inputs, audit job) and own CodeQL, Semgrep or `npm audit` setups; hints `sast` / `sca` only when none is present; new hint `hook-duplicate-checks` when a project's `.husky/pre-commit` also runs `tsc` or tests (lists the lines to remove).
- README: one "Check matrix" (check x local pre-commit / pre-push / CI / nightly / reviewer) and the rule that every check has one local place and runs authoritatively in CI; SAST and SCA are no longer described as opt-in. `docs/architecture.md`: table "Which check owns which risk". `AGENTS.global.md`: the same rule in two lines.
- Reviewer principles have stable ids (`ARCH-1`, `UI-2`, `LOGIC-3`, `SEC-4`, `TQ-5` ...) in `skills/factory-review/references/*.md`; the README "What each reviewer checks" cites them and `test/reviewer-ids.test.js` fails when the two drift.

### Removed
- `add sast`, `add sca` and `init --with sast,sca`; templates `standards-sast.yml` and `standards-sca.yml`; readiness items and doctor hints for them. Mutation and DAST stay opt-in. Migration: nothing to do for projects that call `security.yml@v1`; delete `.semgrep/standards.yml`, `standards-sast.yml` and `standards-sca.yml` if you installed them from 1.7.x.
- Semgrep rules `server-action-missing-auth-guard` (owned by the arch suite action-guard check) and `react-dangerously-set-inner-html` (owned by ESLint `no-restricted-syntax`). Kept: `unsanitized-html-sink`, `insecure-random-for-secret`, `server-action-error-message-passthrough`.

## [1.7.2] - 2026-10-24

### Changed (docs only, no behaviour change)
- README audited and restructured (1101 to about 950 lines): "Start here" block; one gate table (G0-G6) with orchestrator duty, human duty, model role, tool and required evidence; one tier table (examples, spec, builder, reviewers, approver); duplicate pipeline and review diagrams and the SSDLC mega-diagram removed; sections renumbered 1-14 with a verified TOC; new section 2 defines per reviewer the trigger paths, model role, inputs, rules, finding vs pass (blocker/major/minor), verdict, output and escalation, plus a compact OWASP Web/API table; new section 3 with onboarding for new and existing projects and a "which command when" table.
- Corrected: T3 runs all five reviewers (as `risk-tier` does), not "by path"; T2 approver is the only agent approver; Part 2 diagram shows the tier decision at G6; Sonnet product names replaced by model roles; "four layers" of skill protection are five; stale section references in `docs/adoption.md`; the `risk-tier` output name `arch` for the architecture reviewer is documented.
- `AGENTS.global.md` section 1b, `factory-review` SKILL.md and the reviewer brief now use the same wording (model roles per step, reviewer triggers, finding severities and verdicts).

## [1.7.1] - 2026-10-24

### Added
- **Pull request workflow**: rule in `AGENTS.global.md` that agents never push to the default branch and never merge (they push a feature branch and open a PR; T3 needs human approval in the PR). README G6 and the Part 2 diagram say so.
- `pr` command: opens the pull request from the feature branch (template + computed risk tier + commits; `gh pr create` or compare URL and text; `--push`, `--draft`, `--base`, `--title`). Never merges.
- `finish` command: after a merge, fetch, fast-forward the default branch and delete branches proven done (ancestry, merged PR via `gh`, or patch-id heuristic); dry run by default; `--remote`, `--worktrees`.
- `protect-branch` command: prints (dry run) or applies (`--apply`, via `gh`) GitHub branch protection: PR required, strict status checks, no force push or deletion.
- PR template: risk tier, CI evidence, T3 abuse-case table and human checklist.
- `doctor`: readiness checklist (also at the end of `init`) with the exact command per missing item and a list of what only the human can do; hints `branch-protection` and `agent-merge-deny` (Claude Code `Bash(gh pr merge:*)`).

### Changed
- README "What each reviewer checks: the principles" (architecture, UI with the 4-layer diagram, logic, security, test quality); `ui-review.md` and `arch-review.md` carry the same principles.
- `sync-agents --global` writes a short bootstrap block (also for Codex) instead of the full standard; an old full block is replaced on the next run, text outside the block is kept. The full standard lives in each project's `AGENTS.md`. The `duplicate-standards` hint only fires for the full global block.
- Notes: `gh` is never needed by tests or CI; commands that use it degrade to printed instructions. Not verified against a real GitHub (no `gh` on the release machine): `protect-branch --apply`, `pr` with `gh`.

## [1.7.0] - 2026-10-24

### Added
- **`factory-review` skill** (`skills/factory-review/`): risk tiers T0-T3, model roles (`strong`, `mid`, `small`), path-triggered specialist reviewers (security, ui, logic, architecture, test-quality) with checklists, reviewer brief and abuse-case templates. Security review covers OWASP Web Top 10 (2021) and API Security Top 10 (2023), one line per item.
- README: "The delivery flow: who does what, when" with five diagrams, gates G0-G6, a RACI table, reviewer roles and a tier x step table; SSDLC phases link to the gates.
- `AGENTS.global.md`: risk tiers, model roles, tool-first gates (full gate set runs once in CI, reviewers read the evidence), max 2 fix rounds, T3 needs a human approval.
- **Opt-in security templates** (`templates/optional/`, `npx oneup-standards add <sast|sca|mutation|dast|all>` or `init --with ...`): Semgrep rules for Next.js server actions (missing auth guard, `dangerouslySetInnerHTML`, unsanitized HTML sinks, `Math.random()` for secrets, `error.message` passthrough), `npm audit` severity gate, Stryker config with a changed-files CI job, nightly OWASP ZAP baseline. All report only until a repository variable enables blocking. The Semgrep rules were validated for structure only; `semgrep --test` ran nowhere in release (semgrep not installed).
- **`risk-tier` command**: classifies the diff into T0-T3 by changed paths (globs configurable under `riskTiers` in `.standardsrc.json`), prints tier, reviewers and whether a human approval is required; `--json` for CI.
- **`doctor` hints** (never failures): opt-in SAST/SCA/mutation missing, specs without risk tier or abuse cases, `test:unit` vs CI test project, standards block duplicated in project and global `AGENTS.md`, `factory-review` skill not installed.

### Changed
- `AGENTS.global.md` Phase 3 is now specialist review by tier instead of a blanket reviewer who re-runs all checks; the Definition of Done is run once in CI. README section 5 replaces the dual-control sequence diagram.
- `factory-review` is a required skill (pre-flight in `AGENTS.global.md` and README). Notes: `doctor` reports it as missing for Claude Code until you run `upgrade` or `sync-skills`.

## [1.6.0] - 2026-10-19

### Added
- **`ui-consistency` skill** shipped in the package (`skills/`). `sync-skills` installs package skills for Claude Code (`~/.claude/skills`, or `.claude/skills` with `--project`) and Antigravity; bundled skills override plugin skills with the same name.
- Reference stack for React primitives (`cva`, `cn()` with `tailwind-merge`, Radix UI, compound components, role-named tokens) and a visual-regression workflow for refactoring existing UI without visual change (`skills/ui-consistency/references/react-primitives.md`, README §4).
- `doctor` reports missing or outdated standard skills for Claude Code (`claude-skills`).
- `AGENTS.global.md`: `ui-consistency` in the pre-flight, "Reuse UI before building UI" rule, UI check for the reviewer. `AGENTS.project.md`: "UI catalog" section.
- **UI style ratchet**: `checkStyleRatchet` / `styleRatchet` suite option counts arbitrary Tailwind values (`text-[11px]`, `rounded-[18px]`, `p-[13px]`, `bg-[#hex]`) outside the primitives folder; `baseline` records them from `uiStyleRatchet` in `.standardsrc.json`; `doctor` shows the count.

### Changed
- `sync-skills` results carry a `harness` field; updating a skill now removes files that were deleted upstream.
- Notes: `doctor` reports the new `ui-consistency` skill as missing for Claude Code until you run `upgrade` or `sync-skills`. `styleRatchet` is opt-in (commented out in the consumer template).

## [1.5.0] - 2026-10-04

### Added
- **Monotonic ESLint Ratchet**: `oneup-standards baseline` now records `.eslint-suppressions.json` alongside `.dependency-cruiser-known-violations.json` so existing lint violations are frozen and only new ones fail.
- **Ratchets & Technical Debt Tracking in Doctor**: `oneup-standards doctor` now displays an overview of all active monotonic ratchets and technical debt (ESLint suppressions, architecture layer violations, direct DB writes, unguarded server actions).
- **Reusable CI Pipeline (`ci-node.yml`)**: Automatically enforces `.eslint-suppressions.json` with `--suppressions-location` when present.
- **ESLint Agent Ignores**: Added `.agents/**` to default `ignores` in base and Next.js presets so AI skills scripts are excluded from project linting.

## [1.3.0] - 2026-10-03

### Added
- Fleet Anti-Drift Architecture: `oneup-standards doctor` command to diagnose configuration drift and environment readiness.
- `oneup-standards upgrade` command: synchronizes managed templates, hooks, `.gitignore` rules, and AI agent instructions without overwriting custom edits (using SHA-256 fingerprint tracking).
- Reusable CI workflow integration: `ci-node.yml` automatically runs `doctor --warn-only` on PRs to visibly alert teams of configuration drift.
- Comprehensive Secure SDLC documentation in README with risk mitigation matrix, agent dual-control workflow, architecture diagrams, and technical appendices.

## [1.2.0] - 2026-09-30

### Added
- Wizard detects Claude Code and checks if the Superpowers plugin (`superpowers@superpowers-marketplace`) is installed, offering 1-click installation.
- Documented the Subagent Dual-Control workflow and Superpowers setup in README.

## [1.1.0] - 2026-09-30

### Added
- Configurable allowlist/ignore patterns for `check-files` and `pre-commit` via `checkFiles.ignore` in `.standardsrc.json`.
- Optional Java runtime setup (`setup-java`, `java-version`) in `ci-node.yml` for Firebase Emulators.
- Optional build-time environment variables (`build-env`) in `ci-node.yml`.
- Full Next.js 15 & 16 compatibility in `eslint/nextjs.js` (supports both flat arrays and config objects).
- Robust Server Action detection in `arch/index.js` supporting complex TypeScript parameter types in arrow functions.
- Formalized Subagent Dual-Control (Implementer/Reviewer) Protocol in `AGENTS.global.md`.

## [1.0.3] - 2026-09-30

### Added
- Setup wizard asks whether to migrate existing test scripts to Vitest (saving the old script as `test:legacy`).

All notable changes to `@oneup4real/standards`. Versions follow [semver](https://semver.org):
**major** = projects may need code changes, **minor** = new checks or options, **patch** = fixes.

## 1.0.2 — 2026-09-30

- Docs: README explains how it works technically: the three delivery channels (npm package from GitHub, reusable
  workflows, wizard-written files), what runs at each step, a glossary, and the optional strict tsconfig step.

## 1.0.1 — 2026-09-30

- Fix: the secret scan in `security.yml` now runs the pinned, checksum-verified gitleaks binary over the full history
  instead of `gitleaks-action`. The action crashed on a repository's first push (its range started at a commit with
  no parent), targeted the deprecated Node 20 runtime, and needs a license for organisation repositories.

## 1.0.0 — 2026-09-30

First release.

- Setup wizard `oneup-standards init` for new and existing projects (merge instead of overwrite, baseline, update modes).
- Git hooks: forbidden files, gitleaks and lint-staged before commit; typecheck and tests before push.
- ESLint presets (`base`, `nextjs`) with security rules: no DB writes from UI code, no seed/fixture imports, no
  `dangerouslySetInnerHTML`, no secret-looking `NEXT_PUBLIC_*`, no `any`.
- dependency-cruiser layered architecture rules; architecture test kit (server-only, action guards, write ratchet, sets in sync).
- Vitest preset with domain coverage thresholds; strict tsconfig presets.
- Reusable GitHub workflows `ci-node.yml` and `security.yml` (gitleaks, npm audit, Semgrep or CodeQL, dependency review).
- Bundle check for confidential markers in client JavaScript.
- Canonical AI-agent rules with `sync-agents` for AGENTS.md, CLAUDE.md, GEMINI.md and Codex (project and global).
- Firebase rules-testing helpers, a security-headers preset for Next.js, and a PR template.
- TDD enforcement: tests run with coverage in CI; pull requests fail when source changes without test changes
  (`check-tests-changed`, label `no-tests-needed` to skip) or when changed lines are < 80% covered (`check-diff-coverage`).
