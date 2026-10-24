# Test quality (`mid`)

Trigger: tests that protect guards, money, or state logic (always at T3). Coverage proves lines ran, not that
anything is asserted.

## Method
- **Mutation testing:** run the mutation tool (opt-in, e.g. Stryker) on the changed files only; every surviving
  mutant in a guard, comparison or calculation is a missing test. Add the test, rerun that file.
  Without the tool: remove or invert each guard by hand once and confirm a test goes red.
- **Negative controls:** each allowed-case test has a denied-case twin (wrong role, wrong owner, anonymous,
  expired token, out-of-range input). A suite with only happy paths fails review.
- **Snapshot-proof principle:** a test must fail when the behaviour breaks. Snapshots/golden files that are
  regenerated to go green prove nothing; assert on explicit values or named properties.
- **No mocked authorization:** role lookups in tests hit the real function or emulator; mock only the outside world.
- **Determinism:** no sleeps, real clocks or network; fixed time and ids.
- Test names state the rule (`denies approving own request`), not the function.

## Output
Surviving mutants (file:line, operator) and the missing test for each.
