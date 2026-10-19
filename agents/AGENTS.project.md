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

## UI catalog

> Agents: read this before writing UI (skill `ui-consistency`). Keep it current when you add a primitive.

- Primitives folder: _e.g. `src/components/ui/`_
- Catalog: _e.g. `docs/UI_GUIDELINES.md` (each primitive, when to use it, variants)_
- Tokens: _where the theme lives, e.g. `@theme` in `src/app/globals.css`; list the type scale roles_
- Style ratchet: _`uiStyleRatchet` in `.standardsrc.json`, baseline file name_

## Project-specific rules

_Add rules that apply only to this project here (domain vocabulary, compliance scope, special flows)._
