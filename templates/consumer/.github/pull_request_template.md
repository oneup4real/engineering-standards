## What & why

<!-- What does this change, and why? Link the issue if there is one. -->

## Security & architecture

- [ ] Every write goes UI → server action → service (no database writes from UI code)
- [ ] Every new exported server action checks the caller, or has `// @public-action: <reason>` and a rate limit
- [ ] Roles, IDs, owners, prices and e-mail recipients are resolved on the server, not taken from the client
- [ ] No secrets, `.env` files or documents added; nothing confidential reaches the browser bundle

## Tests (test-driven development)

- [ ] Test first: each test was written and seen failing before the code that makes it pass
- [ ] New or changed behaviour is covered (CI checks that tests changed and that changed lines are ≥ 80% covered)
- [ ] No tests needed? → label the PR `no-tests-needed` and explain why here

## Checks

- [ ] `npm run lint`, `npx tsc --noEmit` and `npm test` pass
- [ ] Architecture checks pass (`npm run check:arch`, `tests/arch`)
- [ ] Database rules changed? → rules tests added for allowed **and** denied cases (rules are deployed by a human)
- [ ] `npm run build` passes

## Docs updated?

- [ ] Roles / permissions, collections, upload paths, scripts / CI, or folders changed → matching docs updated
- [ ] None of the above apply
