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

**HALT IF SKILLS ARE MISSING:**
If any core skills (`brainstorming`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`) are missing from your available skills, you MUST stop immediately before editing any code and alert the user:
> ⚠️ **Required AI Skills Missing!**
> The following skills are missing from this session: [list missing skills].
> Please run `npx oneup-standards sync-skills` in your terminal to synchronize your skills into Antigravity (`~/.gemini/config/skills/`), then restart this conversation.
> You must not proceed to write code without these skills active.

## 1. How to work: Subagent Dual-Control Protocol

Every non-trivial task (more than a single 5-line edit) MUST follow this structured subagent execution cycle:

1. **Phase 1: Spec & Step-by-Step Plan (`writing-plans`):**
   - Break the task into atomized, numbered steps (Task 1..N) with explicit acceptance criteria, file targets, and test requirements.
   - Save the plan in `docs/plans/` or `docs/superpowers/plans/`.

2. **Phase 2: Step-by-Step Execution via Implementer Subagents (`executing-plans`):**
   - For EACH task in the plan, dispatch a dedicated **Implementer Subagent**.
   - The Implementer works in isolation: writes the failing test first (TDD), implements minimal code, runs typecheck and unit tests, and verifies the specific DoD for that step.
   - The Implementer NEVER self-approves.

3. **Phase 3: Independent Reviewer Subagent (Dual Control / Four-Eyes Rule):**
   - Immediately upon completion of an implementer task, dispatch a separate **Reviewer Subagent**.
   - The Reviewer operates with a skeptical posture:
     - Verifies code against the original spec and layer architecture rules.
     - Runs `npx tsc --noEmit` and the relevant test suite directly.
     - Checks for regressions, drift, untyped `any`, and missing tests.
   - If the Reviewer finds gaps, dispatch a **Scoped Fix & Re-Review** cycle until green.
   - ONLY after the Reviewer approves may the main orchestrator advance to the next step.

4. **Phase 4: Final System Verification & Evidence (`verification-before-completion`):**
   - Run full project verification (`tsc`, lint, build, tests, dependency-cruiser).
   - Present concrete terminal output as evidence before completion.

5. **Universal Rules:**
   - **Clarify before coding.** If a requirement or compliance interpretation is unclear, ask.
   - **Test first (TDD).** Every change to source code comes with a test change; CI requires at least 80% diff coverage.
   - **Debug systematically.** Prove root cause before editing code.
   - **Verify before claiming done.** "Should work" is never accepted.
   - **Do only the task you were given.** No unrelated refactoring.

If Superpowers skills are available, always activate: `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`.

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

Run these and show the output. Every one must pass:

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
