# Logic review (`mid`)

Trigger: services, domain, state machines, calculations, server actions.
Read first: unit/service test and coverage output. Review what the tests do not pin.

## Method
1. **LOGIC-1** Compare the diff to the spec and each abuse case: is there a test that fails if the behaviour is removed?
2. **LOGIC-2** **State-machine truth table:** list every state x event; mark allowed/denied. Look for impossible or
   inconsistent combinations (e.g. paid but not approved, cancelled but still billable) and for a second
   write path (edit action, import, retry) that skips the transition rule.
3. **LOGIC-3** **Legacy data matrix:** rows = old record shapes (missing field, old enum, null, other currency/unit,
   pre-migration ids); columns = read, display, write, migrate. Each cell is handled or explicitly out of scope.
4. **LOGIC-4** Numbers: rounding, currency, units, time zones, off-by-one on ranges and inclusive dates.
5. **LOGIC-5** Concurrency and idempotency: double submit, retry, two staff editing; transactions where read-then-write.
6. **LOGIC-6** Error paths return the action contract; no partial writes left behind.

## Output
List only failing cells and missing tests, each with the input that breaks it.
