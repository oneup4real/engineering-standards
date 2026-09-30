# Reference architecture

## Layers

| Layer | Folder (Next.js) | Responsibility | May import |
|---|---|---|---|
| Presentation | `src/app`, `src/components`, `src/hooks`, `src/context` | Render UI, call server actions | shared, domain (pure helpers), server **actions** only |
| Boundary | `src/app/actions` or `src/server/actions` | `'use server'`, verify identity, Zod validation, role check, audit entry | services, shared, domain |
| Services | `src/server/services` | Use cases, business rules, transactions | adapters (via ports), domain, shared |
| Adapters | `src/server/adapters` | Firestore / HTTP / secret manager | external SDKs |
| Domain | `src/domain` | Pure logic, port interfaces | domain, shared only |
| Shared | `src/shared` | Types, Zod schemas | nothing app-specific |

Enforced by `depcruise/layered.cjs`, the ESLint security rules and `arch/suite.js`.

## A write, end to end

```
Button click (client component)
  → server action  updateRisk(input)                    src/app/actions/riskActions.ts
      1. const user = await requireRole('ciso')          identity from the verified token, never from input
      2. const data = RiskUpdateSchema.parse(input)       Zod: trim, cap lengths, enums
      3. const result = await riskService.update(user, data)
            → re-reads the record, checks ownership (IDOR)
            → riskRepository.update(...)                  adapter, Admin SDK
            → auditTrail.record({ userId: user.uid, … })  server-side, append-only
      4. return { success: true, data: result }           or { success: false, error, code }
```

## Firebase / Firestore

- **Client writes are denied** in the rules (`allow write: if false`); all writes go through the Admin SDK in services.
  A catch-all `match /{document=**} { allow read, write: if false; }` keeps new collections closed by default.
- **Signed in is not authorized.** Anonymous sessions and "any account" never pass role checks. Check roles from custom
  claims or a users document that only the Admin SDK can write.
- **Rules are tested** with `@oneup4real/standards/firebase-testing` against the emulator, with an allowed and a denied
  case for each role and collection. `assertEmulator()` makes tests fail if they could reach production.
- **Rules are deployed by a human**, never by CI or an AI agent.
- **Public endpoints** (no login) are rate-limited and return reduced view models without personal data; mapper tests
  pin that boundary.

## Classifying findings

Use these buckets in security reviews and issues.

| Severity | Meaning | Response |
|---|---|---|
| **P0 Critical** | Exploitable now by outsiders, or confidential data exposed | fix immediately |
| **P1 High** | Insider privilege escalation, or integrity of evidence/audit broken | current sprint |
| **P2 Medium** | Needs extra conditions, or a defense-in-depth gap | next 1–2 sprints |
| **P3 Low** | Hygiene, hardening | backlog |

Type tags: `AUTHN` · `AUTHZ` · `EXPO` (data exposure) · `INTEG` (data/audit integrity) · `INJ` (injection/XSS) ·
`SUPPLY` (dependencies) · `HYG` (secrets/repo hygiene) · `ARCH` · `COMPL` (ISO 27001 / GDPR evidence).
