# Engineering Standards — Design

**Date:** 2026-09-30 · **Owner:** oneup4real · **Status:** approved in conversation, pending plan review

## Problem

ISMS-GUARDIAN had a detailed AGENTS.md (layered architecture, Zod at the boundary, RBAC, audit trail), yet the
code violates most of it: client pages write straight to Firestore, confidential seed data ships in the public
bundle, the audit trail is forgeable. Root cause: the rules were **instructions without enforcement**. The DoD
gates (`tsc`, `lint`, `build`, unit tests) all pass on insecure code, and each AI session copied the existing
code rather than the document. The same drift will happen in every other project unless the rules are central
and machine-checked.

## Goal

One public repo, `oneup4real/engineering-standards`, that every project (new and existing) consumes by
reference, so that:

1. The same secure-SDLC checks run everywhere (hooks, lint, architecture, tests, security scans, CI).
2. Rule changes are made once and reach projects as a version bump (Dependabot PR).
3. Every AI tool (Claude Code, Codex, Gemini/Antigravity, Copilot, Cursor) receives the same instructions.
4. Enforcement never depends on an agent reading its instructions: required CI checks block the merge.

## Decisions

| Topic | Decision |
|---|---|
| Location | Personal account `oneup4real`, **public** repo (contains no secrets or customer data). |
| Distribution | One npm package `@oneup4real/standards` at the repo root, plain ESM JavaScript, no build step. Consumers install it from git: `github:oneup4real/engineering-standards#semver:^1.0.0`. No npm account or token needed. |
| Consumption | Thin files in each project that *reference* the package (`eslint.config.mjs`, `tsconfig.json` extends, `.dependency-cruiser.cjs`, `vitest.config.ts`, Husky hooks) and CI that *references* reusable workflows (`uses: …/ci-node.yml@v1`). |
| Agent instructions | **AGENTS.md is canonical** (multi-LLM user). The package writes a managed block between markers into AGENTS.md and preserves everything else. `CLAUDE.md` = `@AGENTS.md`, `GEMINI.md` = `@AGENTS.md`. Global: `~/.agents/AGENTS.md` with pointers from `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, and a copy in `~/.codex/AGENTS.md` (Codex has no import syntax). |
| Process discipline | Superpowers skills (brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion). AGENTS.md carries a short inline version for tools without skill support. |
| Existing projects | Ratchet: record current architecture violations as a baseline, block only **new** violations, shrink the baseline over time. |
| Hard enforcement | GitHub branch ruleset on `main` requiring the `ci` and `security` checks. |

## Reference architecture (enforced for Next.js projects)

```
src/app, src/components, src/hooks   Presentation — UI only, no DB write APIs, no seed/fixture data
src/server/actions                   Boundary — 'server-only', verify identity, Zod, RBAC, write audit entry
src/server/services                  Use cases
src/server/adapters                  Firestore/HTTP/Secret Manager implementations of domain ports
src/domain                           Pure logic + port interfaces; imports only src/domain and src/shared
src/shared                           Types, Zod schemas
```

## Pipeline

| Stage | Checks |
|---|---|
| pre-commit | forbidden files (`.docx .xlsx .xls .pptx .pdf .pem .p12 .key .env*` except `.env.example`, service-account JSON), gitleaks on staged changes, lint-staged |
| pre-push | `tsc --noEmit`, unit tests |
| PR CI (`ci-node.yml`) | lint (errors fail), typecheck, Vitest with coverage thresholds, dependency-cruiser (with baseline), optional DB-rules tests command, build, bundle check for forbidden markers |
| Security (`security.yml`) | gitleaks (full history), CodeQL, `npm audit --omit=dev --audit-level=high`, dependency-review on PRs |
| Continuous | Dependabot (grouped weekly), GitHub secret scanning + push protection |

## Security lint rules (Next.js preset)

- Named imports `setDoc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction` from `firebase/firestore` are errors in `src/app`, `src/components`, `src/hooks`, `src/context`.
- Importing any `seed-data*` / `fixtures*` module from `src/**` (non-test) is an error.
- `dangerouslySetInnerHTML` is an error.
- `process.env.NEXT_PUBLIC_*` names containing `SECRET`, `TOKEN`, `PRIVATE`, `PASSWORD` are errors.
- `@typescript-eslint/no-explicit-any` is an error.

## Out of scope for the first plan

- Rolling out to ISMS-GUARDIAN (plan 2).
- `template-nextjs` and custom skills `/secure-init`, `/threat-model`, `/arch-check` (plan 3).
- Pushing to GitHub and configuring rulesets (done after the user reviews the local repo).
