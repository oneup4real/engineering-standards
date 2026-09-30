# Changelog

All notable changes to `@oneup4real/standards`. Versions follow [semver](https://semver.org):
**major** = projects may need code changes, **minor** = new checks or options, **patch** = fixes.

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
