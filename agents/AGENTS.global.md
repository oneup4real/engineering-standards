# Engineering Standards (oneup4real)

These rules apply to every project and every AI coding tool (Claude Code, Codex, Gemini/Antigravity,
Copilot, Cursor). They are binding. Project-specific rules elsewhere in this file add to them; where a
project rule is stricter, the stricter rule wins.

## 1. How to work

1. **Clarify before coding.** If a requirement, interface or compliance interpretation is unclear, ask.
   Do not guess.
2. **Plan before multi-step changes.** Write the plan (files, signatures, tests), show it and wait for an OK.
3. **Test first (TDD).** Write the failing test, watch it fail, write the minimal code, watch it pass.
   Every change to source code comes with a test change; CI fails a pull request otherwise, and requires at
   least 80% of the changed lines to be covered. Never add the `no-tests-needed` label yourself.
4. **Debug systematically.** Find and prove the root cause before changing code. Never patch the symptom.
5. **Verify before claiming done.** Run the Definition of Done commands and show their output.
   "Should work" is not evidence.
6. **Do only the task you were given.** No refactoring or restyling of unrelated code.

If the Superpowers skills are available, use them for these steps: `brainstorming`, `writing-plans`,
`executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`,
`requesting-code-review`.

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
