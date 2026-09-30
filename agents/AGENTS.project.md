# Project Agent Instructions

## Current state vs. target

> Agents: treat everything in the **Target** column as *not yet built* unless **Current** says it is.
> Keep this table up to date when you change the architecture.

| Area | Current | Target | Tracking issue |
|---|---|---|---|
| Data writes | _describe how writes happen today_ | UI → server action → service → adapter | |
| Authorization | _where roles are checked today_ | Server-side, from the verified token | |
| Audit trail | _how/if audit entries are written_ | Server-side, verified user, append-only | |
| Tests | _what exists_ | Unit, architecture, rules and service tests in CI | |

## Project-specific rules

_Add rules that apply only to this project here (domain vocabulary, compliance scope, special flows)._
