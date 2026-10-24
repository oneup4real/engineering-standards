# Reviewer brief (copy, fill, dispatch)

Keep it under 25 lines. Fresh context: pass paths, not the conversation.

```
ROLE: <security|ui|logic|architecture|test-quality> reviewer, model role <strong|mid|small>
TIER: <T0-T3>   SCOPE: <diff range / files>   SPEC: <path>   ABUSE CASES: <path or none>
ATTACK BRIEF (one line, specific): <e.g. "stored XSS via ticket title; short code used as credential; bypass via the edit action; inconsistent paid/approved state">
READ, do not re-run: <CI run link or output files: lint, types, tests, coverage, depcruise, SAST, mutation>
CHECKLIST: skills/factory-review/references/<file>.md
DO NOT: re-run gates, restyle, refactor, review files outside SCOPE, repeat tool findings, approve your own earlier work.
OUTPUT (max 40 lines):
  VERDICT: approve | changes-requested | escalate
  FINDINGS: id | severity (blocker/major/minor) | file:line | proof (input or test that breaks) | fix hint
  UNCHECKED: what you could not verify and why
```

Round limit: this is review round <1|2>. After round 2 with open blockers, escalate to the human.
