# Adoption guide

## New project

Run `npx oneup-standards init` right after creating the project (see README §2). There are no existing
violations, so skip the baseline.

## Existing project: the ratchet approach

Existing code rarely passes every rule on day one. Don't turn rules off. Freeze today's state and only allow
improvement:

| Ratchet | File | Rule |
|---|---|---|
| Architecture violations | `.dependency-cruiser-known-violations.json` | `npx oneup-standards baseline` writes it; CI uses `--ignore-known` |
| Direct DB writes outside server code | `arch-allowlist.json` | per-file counts; fails when a count grows, asks you to lower it when it shrinks |
| Unguarded server actions | `arch-action-gaps.json` | per-function exceptions with a reason (e.g. a ticket number) |
| Lint warnings | `.lintstagedrc.json` | `--max-warnings=0` on **changed** files, so every file you touch gets cleaned |

Rules for everyone, humans and AI agents alike: **ratchet files only shrink.** Never add entries; fix the code.

Suggested order for a project with many findings:

1. P0 security issues first (exposed data, missing authorization, secrets).
2. Move database writes behind server actions, one feature at a time. The write ratchet shows progress.
3. Guard every server action.
4. Clean up architecture violations until the baseline file is empty, then delete it.

## Personal AI setup (once per machine)

```bash
npx --yes --package=github:oneup4real/engineering-standards#semver:^1.0.0 oneup-standards sync-agents --global
```

This writes `~/.agents/AGENTS.md` and points Claude Code, Gemini and Codex to it. Re-run it after updating the standards.

## GitHub settings per repository

- Ruleset on the default branch: restrict deletions, block force pushes, require a pull request, and require status
  checks `ci / ci`, `security / gitleaks`, `security / audit`, and `security / semgrep` or `security / codeql`.
- Code security: secret scanning with push protection, Dependabot alerts and security updates.
- For `updateMode: auto`: Settings → General → **Allow auto-merge**.

Private repositories on a free personal plan cannot enforce rulesets or use CodeQL and secret scanning. See README §4.
