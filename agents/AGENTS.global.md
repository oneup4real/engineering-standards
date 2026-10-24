# Engineering Standards (oneup4real)

These rules apply to every project and every AI coding tool (Claude Code, Codex, Gemini/Antigravity,
Copilot, Cursor). They are binding. Project-specific rules elsewhere in this file add to them; where a
project rule is stricter, the stricter rule wins.

## 0. Mandatory Pre-Flight: AI Skills Verification

Before writing code, designing features, or modifying files:
Check whether the required AI skills are loaded in your context:
- `brainstorming`
- `writing-plans`
- `executing-plans`
- `test-driven-development`
- `systematic-debugging`
- `verification-before-completion`
- `requesting-code-review`
- `frontend-design`
- `superdesign`
- `ui-consistency`
- `factory-review`

**HALT IF SKILLS ARE MISSING:**
If any core skills (`brainstorming`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`) are missing from your available skills, you MUST stop immediately before editing any code and alert the user:
> ⚠️ **Required AI Skills Missing!**
> The following skills are missing from this session: [list missing skills].
> Please run `npx oneup-standards sync-skills` in your terminal to synchronize your skills into Antigravity (`~/.gemini/config/skills/`) and Claude Code (`~/.claude/skills/`), then restart this conversation.
> You must not proceed to write code without these skills active.

If the task touches UI and `ui-consistency` is missing, halt the same way.

## 1. How to work: Subagent Dual-Control Protocol

Every non-trivial task (more than a single 5-line edit) MUST follow this structured subagent execution cycle:

1. **Phase 1: Spec & Step-by-Step Plan (`writing-plans`):**
   - Break the task into atomized, numbered steps (Task 1..N) with explicit acceptance criteria, file targets, and test requirements.
   - Save the plan in `docs/plans/` or `docs/superpowers/plans/`.

2. **Phase 2: Step-by-Step Execution via Implementer Subagents (`executing-plans`):**
   - For each task, dispatch an **Implementer Subagent** (model role by tier, see below).
   - It works in isolation: failing test first (TDD), minimal code, fast local checks, the step's DoD. It NEVER self-approves.

3. **Phase 3: Specialist Review (Four-Eyes, by tier; details in the `factory-review` skill):**
   - The reviewer is never the implementer and starts with fresh context (spec, diff, CI output).
   - Reviewers are triggered by changed paths, not by default: security, ui, logic, architecture, test-quality.
   - Reviewers READ the CI/tool output and review only what tools cannot check; they do not re-run gates.
   - Skeptical posture: verify against the spec and abuse cases, check regressions, drift, untyped `any`, missing tests.
   - Checks UI changes against the project's UI catalog: primitives reused, no arbitrary style values outside the primitives folder, no duplicated components.
   - Findings go back to the implementer. Max 2 fix rounds, then escalate to the human with the open findings.
   - Only after the reviewers approve may the orchestrator advance.

4. **Phase 4: Final Verification & Evidence (`verification-before-completion`):**
   - Locally run only the fast checks (typecheck, changed tests). The full gate set (lint, tests, coverage, depcruise, build, bundle, SAST) runs once in CI; cite its output.

5. **Universal Rules:**
   - **Clarify before coding.** If a requirement or compliance interpretation is unclear, ask.
   - **Test first (TDD).** Every change to source code comes with a test change; CI requires at least 80% diff coverage.
   - **Debug systematically.** Prove root cause before editing code.
   - **Verify before claiming done.** "Should work" is never accepted.
   - **Do only the task you were given.** No unrelated refactoring.
   - **Reuse UI before building UI.** Before writing UI, follow `ui-consistency`: read the project's UI catalog and primitives folder, and put a reuse table in the plan. Use design tokens, never arbitrary values (`text-[11px]`, `rounded-[18px]`). New primitives go into the primitives folder and the catalog, built with the reference stack (`cva` variants, `cn()` with `tailwind-merge`; for interactive parts Radix UI or the project's own single implementation in the primitives folder). Use `frontend-design` only for new products or redesigns the human asked for.
   - **Refactor UI only behind a visual baseline.** Moving existing screens onto primitives or tokens must not change how they look: screenshot baseline first, zero pixel diff after, and never update snapshots without the human's approval.

If Superpowers skills are available, always activate: `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`.

## 1b. Risk tiers, model roles, tool-first (skill `factory-review`)

Classify every task at the start and state the tier in the plan. The highest matching tier wins.

| Tier | Scope | Spec | Builder | Review | Merge |
|---|---|---|---|---|---|
| T0 | docs, formatting, mechanical edits | none | `small` | tools only | CI green |
| T1 | UI only, no logic | short | `small` | tools + ui (once per batch) | CI green |
| T2 | business logic | spec + tests | `mid` | tools + logic, test-quality, architecture as triggered | CI green + approver |
| T3 | security, money, roles, public endpoint, data migration | spec with abuse cases, each becomes a test | `mid` | all specialists, `strong` security review | **human approval before merge/release, always** |

- Model roles, never product names: `strong` = spec, architecture, T3 security review, final approver; `mid` = T2/T3 builder, standard reviewers; `small` = mechanical edits, T0/T1 builder, doc and format fixes. Escalate a role only after a failed round.
- Tools before agents: lint, types, tests, coverage, depcruise, SAST, secret scan, bundle check decide first; an LLM reviewer never repeats what a tool proves.
- Review triggers by path (auth, rules, actions, payments, money, `src/components`, `src/server`); every T3 review answers OWASP Web Top 10 and API Security Top 10 with one line per applicable item.
- `npm run test:unit` must run the same test project as CI. Numbers and counts claimed in docs must be verified by script where possible.

## 2. Architecture

| Layer | Folder (Next.js) | May contain |
|---|---|---|
| Presentation | `src/app`, `src/components`, `src/hooks`, `src/context` | UI only. Reads via server actions or read-only queries. |
| Boundary | `src/server/actions` or `src/app/actions` | `'use server'`, identity check, Zod validation, role check, audit entry |
| Services | `src/server/services` | Use cases and business rules |
| Adapters | `src/server/adapters` | Database, HTTP, secret manager. Implement domain ports. |
| Domain | `src/domain` | Pure logic and port interfaces. Imports only `src/domain` and `src/shared`. |
| Shared | `src/shared` | Types and Zod schemas |

Every file under `src/server/` starts with `import 'server-only'`.

Every write goes **UI → server action → service → adapter**.

Server actions return one contract:
`{ success: true, data?: T } | { success: false, error: string, code?: string }`.

If this project's code does not follow this yet, see "Current state vs. target" in this file. Never
assume the target architecture already exists.

## 3. NEVER

- NEVER write to the database from client code (`setDoc`, `addDoc`, `updateDoc`, `deleteDoc`, `writeBatch`,
  `runTransaction` or equivalents in UI code).
- NEVER import seed data, fixtures or test data into `src/` (it ships to every browser).
- **NEVER loosen database security rules, permissions or validation to make an error go away. Report the
  error and ask.**
- NEVER deploy database or storage rules yourself. A human deploys them.
- NEVER add entries to a ratchet or baseline file (known-violations, allow-lists). Fix the code instead.
- NEVER put secrets in `NEXT_PUBLIC_*` or any other client-exposed variable.
- NEVER commit `.env` files, keys, service-account JSON, or office/PDF documents.
- NEVER fabricate audit entries, log records, test results or evidence. No placeholder data presented as real.
- NEVER hard-code user identities (`'current-user'`, fixed UIDs, personal e-mail addresses) in application logic.
- NEVER treat "is signed in" (`request.auth != null`, including anonymous sessions) as an authorization check.
- NEVER trust client-supplied roles, user IDs, owner fields, prices or recipients.
- NEVER render unsanitized HTML (`dangerouslySetInnerHTML`) or open user-supplied URLs without scheme checks.
- NEVER mark a stub, mock or TODO as finished.

## 4. ALWAYS

- ALWAYS validate every input at the server boundary with Zod: trim strings, cap lengths, and check enums
  and numbers.
- ALWAYS derive identity and roles from the verified token on the server.
- ALWAYS re-read ownership server-side before acting on "your own" record (IDOR).
- ALWAYS write audit entries server-side with the verified user ID, a timestamp and the reason.
- ALWAYS rate-limit public (unauthenticated) endpoints and return reduced view models (no PII). Cover the
  mappers with tests.
- ALWAYS allow only `https:` (and explicitly listed schemes) for user-supplied links.
- ALWAYS add both allowed and denied test cases when you change database rules.
- ALWAYS keep docs in sync in the same change: when roles, collections, upload paths, scripts or CI change,
  update the matching documentation.

## 5. Definition of Done

Every one must pass. CI runs them once; agents run the fast ones locally and cite the CI output instead of re-running:

```bash
npm run lint
npx tsc --noEmit
npx vitest run --coverage   # or npm test in projects without Vitest
npx depcruise src --config .dependency-cruiser.cjs
npm run build
npx oneup-standards check-bundle
```

Also run the rules tests if database rules changed, and the service tests if services changed.
Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).

## 6. When a check fails

A failing check is information, not an obstacle. Read the message, find the cause, fix the code.
Do not disable the check, add an ignore comment, extend a baseline or skip a hook (`--no-verify`) unless
the human explicitly asks for it in this conversation.
