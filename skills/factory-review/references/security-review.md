# Security review (`strong` at T3, `mid` at T2 when triggered)

Trigger: auth, roles, server actions, security rules, payments/money, public routes, uploads, data migrations.
Read first: SAST, secret-scan, audit, rules-test and mutation CI output. Do not re-run them.
Value comes from a specific ATTACK brief, not a generic checklist: name the assets and try to break them.

## Method
1. **SEC-1** **Enumerate every write path** (actions, API routes, rules, scheduled jobs, imports, edit/bulk variants) and
   for each: who can call it (anonymous, token holder, any signed-in, role X)? Is that what the spec says?
   The edit/update twin of a guarded create is the usual bypass.
2. **SEC-2** **Real role lookup in tests.** Authorization tests call the real role resolution or the emulator, never a
   mocked `isAdmin`. Anonymous sessions are not staff.
3. **SEC-3** **Mutation-check the guards.** Remove or invert each guard once (or run the mutation tool); a test must go red.
   Surviving mutants are findings.
4. **SEC-4** **Real-browser fuzz for sanitizers.** Feed XSS payload lists through every stored field and render the page in
   a real browser; assert nothing executes. Unit tests of the sanitizer alone do not count.
5. **SEC-5** **Input bounds.** Every string trimmed and length-capped, numbers ranged, enums closed, arrays bounded, files typed and sized.
6. **SEC-6** **Idempotency of public actions.** Double submit and retry produce one effect.
7. **SEC-7** **Rate limits** on every unauthenticated endpoint; reduced view models (no PII) in responses.
8. **SEC-8** **Credentials.** A short or guessable code is never a credential; tokens are long, random, scoped, expirable.
9. **SEC-9** **State consistency.** Look for combinations the model forbids (paid but not approved).
10. **SEC-10** Secrets never in client-exposed variables; links accept only `https:` (and listed schemes).

## OWASP Web Top 10 (2021) in this stack

| Item | Check here | Tool first | Evidence |
|---|---|---|---|
| A01 Broken Access Control | every action guards in its body; ownership re-read server-side; rules deny by default | arch suite action guards, rules tests | allowed + denied tests per path |
| A02 Cryptographic Failures | no secrets in client vars; tokens from CSPRNG; TLS/HSTS headers | gitleaks, `check-bundle`, header test | scan output, token test |
| A03 Injection | Zod at the boundary; no string-built queries/paths; no `dangerouslySetInnerHTML` | ESLint security, Semgrep/CodeQL | SAST report, fuzz result |
| A04 Insecure Design | abuse cases exist and are tests; trust boundaries named | spec lint (abuse-case section present) | abuse-case table with test names |
| A05 Security Misconfiguration | CSP/XFO headers; rules and indexes deployed by a human; no debug routes | header test, rules tests | test output, rules diff |
| A06 Vulnerable Components | no new unvetted dependency; pinned actions | `npm audit`, Dependabot, action pinning check | audit output |
| A07 Identification & Authentication Failures | verified token on server; anonymous != staff; session/link expiry | action guard tests with real role lookup | denied-case tests |
| A08 Software & Data Integrity Failures | CI actions pinned; no unsigned remote scripts; migrations reversible/dry-run | pin check, lockfile check | CI config diff |
| A09 Logging & Monitoring Failures | audit entry server-side with verified uid, time, reason; no PII in logs | grep/lint for audit call in writes | audit assertion in tests |
| A10 SSRF | server fetches only allow-listed hosts; user URLs scheme-checked | Semgrep SSRF rule | rule output, URL test |

## OWASP API Security Top 10 (2023) in this stack

| Item | Check here | Tool first | Evidence |
|---|---|---|---|
| API1 Broken Object Level Authorization | each action loading by id re-checks owner/role/token scope | guard tests, IDOR test | foreign-record denied test |
| API2 Broken Authentication | token verified server-side; capability tokens long, random, expiring | token unit tests | brute-force/expiry tests |
| API3 Broken Object Property Level Authorization | response is a reduced view model; client cannot write role, price, owner, status | mapper tests | mapper snapshot with explicit fields |
| API4 Unrestricted Resource Consumption | page size, body, upload and array caps; rate limit on public endpoints | Zod bounds lint, rate-limit test | over-limit test |
| API5 Broken Function Level Authorization | staff/admin actions check role in the body; edit/bulk twins checked too | arch suite action guards | per-role matrix test |
| API6 Unrestricted Access to Sensitive Business Flows | booking, payment-reported, invites limited per actor; idempotent | rate-limit + idempotency tests | repeat-call test |
| API7 Server-Side Request Forgery | see A10 | Semgrep | as A10 |
| API8 Security Misconfiguration | no wildcard CORS, verbose errors, or open rules; errors do not leak internals | header/rules tests | error-shape test |
| API9 Improper Inventory Management | no orphan or debug actions/routes; every public action marked with reason | arch suite public-action list | list diff in PR |
| API10 Unsafe Consumption of APIs | third-party payloads (webhooks, mail, payment) validated and signature-checked | Zod on inbound, signature test | invalid-signature test |

## Output (T3)
One line per applicable OWASP item: `A01 ok|finding|n/a - evidence`. Findings follow the reviewer brief format.
