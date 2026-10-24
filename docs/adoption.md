# Adoption guide

## New project

Run `npx oneup-standards init` right after creating the project (see [README section 3](../README.md#3-adopt-it-new-and-existing-projects)). There are no existing
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

## Security scans and opt-in checks

**One security pipeline.** SAST and SCA are not templates: the shared `security.yml@v1` (called from `ci.yml`) runs gitleaks over the full history, `npm audit --omit=dev` (input `audit-level`, default `high`), Semgrep (`semgrep: true`: registry packs plus our rules) or CodeQL (`codeql: true`), and dependency review.

Our Semgrep rules (`semgrep/standards.yml`: unsanitized HTML sinks, `Math.random()` for secrets, `error.message` returned from actions) reach consumers without copying: the semgrep job fetches that one file from `oneup4real/engineering-standards` at `standards-ref` (default `v1`). A project's own `.semgrep/standards.yml` wins; if the fetch fails the scan runs with the registry packs only. The local `pre-commit` hook scans staged files with the same rules (shipped in the npm package) when `semgrep` is installed (`brew install semgrep`).

Hooks are report-only by default. In `.standardsrc.json`: `"hooks": { "sastBlocking": true, "auditBlocking": true, "auditLevel": "high" }`. `pre-push` audits only when `package-lock.json` changed against the upstream and the network is reachable.

Two checks are opt-in and report-only until you switch blocking on:

```bash
npx oneup-standards add mutation dast
npx oneup-standards init --with mutation,dast   # same, during setup
```

| Feature | Files | Report-only until (repository variable) | Notes |
|---|---|---|---|
| `mutation` | `stryker.config.mjs`, `standards-mutation.yml` | `STANDARDS_MUTATION_BREAK=<percent>` | Install `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`. CI mutates only the files changed in the PR (`STRYKER_MUTATE`). Use it for T3 test-quality review. |
| `dast` | `standards-dast.yml` | `STANDARDS_DAST_BLOCKING=true` | OWASP ZAP baseline (passive) nightly and on demand, never on PRs. Needs a reachable target in the secret/variable `DAST_TARGET_URL`: a deployed staging/preview or a `dev:seeded` server exposed to the runner. Never production data. Skips itself without a target. |

Files that already exist are not overwritten (`--force` replaces and keeps `.bak`). `doctor` shows which are present (as hints).

## Personal AI setup (once per machine)

```bash
npx --yes --package=github:oneup4real/engineering-standards#semver:^1.0.0 oneup-standards sync-agents --global
```

This writes a short bootstrap block (not the full standard) into `~/.agents/AGENTS.md` and points Claude Code, Gemini and Codex to it; Codex gets the same block in `~/.codex/AGENTS.md`. Your own text outside the block is kept, and an old full block is replaced. The full standard travels in each project's `AGENTS.md` (`init` or `sync-agents` in the project), so it is not read twice. Skills: `npx oneup-standards sync-skills`.

## GitHub settings per repository

Two levels of protection: the **local guard** (the pre-push hook refuses direct pushes to the default branch; default, works on private repos on the free plan; a human can override once with `ONEUP_ALLOW_DEFAULT_PUSH=1`; it does not stop someone who edits hooks or uses `--no-verify`) and **GitHub branch protection** via `protect-branch` (binding for everyone; needs a public repo or a Pro/Team plan; recommended once more than one person works in the repo or the default branch deploys to production). With several people, a Pro account or organisation plan plus `protect-branch` is the better choice. Claude Code tip: deny `Bash(gh pr merge:*)` and `Bash(git push origin main:*)` in `.claude/settings.json`.

- Ruleset on the default branch: restrict deletions, block force pushes, require a pull request, and require status
  checks `ci / ci`, `security / gitleaks`, `security / audit`, and `security / semgrep` or `security / codeql`.
- Quick setup of the first bullet (classic branch protection; `init` can create the ruleset instead): `npx oneup-standards protect-branch` (dry run), then `--apply`. Agents push feature branches and open pull requests; only a human merges.
- Daily flow: agent works on a feature branch, `npx oneup-standards pr` (add `--push` to push first) opens the pull request, you review and merge on GitHub, then `npx oneup-standards finish --apply` updates your local `main` and deletes the finished branch. Enable Settings > General > "Automatically delete head branches" so GitHub removes the remote branch. Squash merges make git report the branch as unmerged; `finish` checks the pull request first.
- Block agents from merging in Claude Code: `permissions.deny` containing `Bash(gh pr merge:*)` in `.claude/settings.json`.
- Readiness: `init` ends with, and `doctor` prints, a checklist of what is set up and the command for each missing item (gh, `gh auth login`, branch protection, skills, hooks, CI, optional tools).
- Code security: secret scanning with push protection, Dependabot alerts and security updates.
- For `updateMode: auto`: Settings → General → **Allow auto-merge**.

Private repositories on a free personal plan cannot enforce rulesets or use CodeQL and secret scanning. See [README section 9](../README.md#9-make-the-checks-mandatory-on-github).
