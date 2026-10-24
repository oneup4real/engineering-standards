# Risk tiers

The highest matching tier wins. When unsure, take the higher tier. A tier is stated in the plan and may only
go up during the work, never down.

## Decision questions (in order)

| # | Question | Yes |
|---|---|---|
| 1 | Does it touch authentication, authorization, roles, security rules, money or prices, a public (unauthenticated) endpoint, uploads, secrets, or migrate/delete existing data? | T3 |
| 2 | Does it change business rules, state transitions, calculations, validation, or server actions/services? | T2 |
| 3 | Does it change UI (components, pages, styles) without changing logic? | T1 |
| 4 | Docs, comments, formatting, renames, dependency bumps without API change? | T0 |

## Definitions and examples

| Tier | Examples | Spec | Builder | Review | Merge |
|---|---|---|---|---|---|
| T0 | typo, README, lint autofix, rename | none | `small` | tools only | CI green |
| T1 | new button variant, spacing fix, migrate screen to primitives | 3-line brief | `small` | tools, ui (one review per batch, not per task) | CI green |
| T2 | new status transition, fee calculation, new server action for staff | spec, tests listed | `mid` | tools, logic; architecture and test-quality by path | CI green, approver agent |
| T3 | role change, payment-reported flow, public booking link, Firestore rule, data backfill | spec with abuse cases | `mid` | tools, security + logic + test-quality always; ui and architecture by path; `strong` security review | **human approval before merge/release, always** |

## Rules
- Mixed change: split it. UI parts of a T3 change still follow T3 for the shared PR.
- T3 approval is a human act (comment or review on the PR); an agent approver never replaces it.
- Rules/index deployment stays human-only at every tier.
