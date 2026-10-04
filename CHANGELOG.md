# Changelog

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
