# Model roles

Name roles, never products; the harness maps roles to whatever models it has.

| Role | Does | Never used for |
|---|---|---|
| `strong` | spec and abuse cases (T3), architecture decisions, T3 security review, final approver | mechanical edits, formatting, repeated gate runs |
| `mid` | builder for T2/T3, standard reviewers (logic, architecture, test-quality, ui) | architecture decisions, T3 security sign-off |
| `small` | T0/T1 builder, mechanical refactors, doc and format fixes, collecting tool output | anything touching a guard, money or state rule |

## Escalating a role
- Escalate one step (`small` -> `mid` -> `strong`) only after a failed fix round, or when the builder reports it cannot state the invariant.
- Do not escalate to retry the same prompt; change the brief (add the failing evidence) first.
- The reviewer must not be the same session as the builder. A different role is fine and cheaper.

## Token rules
- Pass diff, spec, and tool output paths, not the conversation.
- One review per batch for mechanical work; per-task review only for T2/T3.
- Findings that a tool can find (missing test, wrong number in docs, style value) become a tool check, not a recurring LLM finding.
