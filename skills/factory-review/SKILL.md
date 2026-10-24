---
name: factory-review
description: Use when planning, building or reviewing a non-trivial change - classifies the risk tier (T0-T3), picks model roles and path-triggered specialist reviewers (security, ui, logic, architecture, test-quality), and sets the fix-loop and human-approval rules. Mandatory for anything touching security, money, roles, public endpoints or data migrations.
---

# Factory Review

Highest quality and security with the fewest tokens: cheap deterministic tools first, LLM reviewers only
where triggered, the smallest sufficient model per role, gates run once in CI.

## 1. Classify (highest matching tier wins)

Ask in order; the first Yes sets the tier. Details and examples: `references/tiers.md`.

1. Security, money, roles, public endpoint, or data migration? **T3**
2. Business logic or state change? **T2**
3. UI only? **T1**
4. Otherwise (docs, formatting, mechanical) **T0**

State the tier in the plan. T3 always needs a human approval before merge/release.

## 2. Run

1. Spec (T2: tests listed; T3: abuse cases from `references/abuse-cases-template.md`, each becomes a test).
2. Builder by tier, model roles in `references/model-roles.md` (`strong`, `mid`, `small`).
3. Tools gate in CI first. Reviewers READ that output; they never re-run gates.
4. Dispatch only the reviewers the changed paths trigger, with `references/reviewer-brief-template.md`.
5. Max 2 fix rounds, then escalate to the human with the open findings.

## 3. Reviewer references

| Reviewer | Trigger paths | File |
|---|---|---|
| security | auth, actions, rules, payments, public routes, uploads | `references/security-review.md` |
| ui | `src/components`, styles | `references/ui-review.md` (uses `ui-consistency`) |
| logic | `src/server/services`, `src/domain`, state machines | `references/logic-review.md` |
| architecture | new folders, imports, actions | `references/arch-review.md` |
| test-quality | tests of guards and money/state logic | `references/test-quality.md` |
