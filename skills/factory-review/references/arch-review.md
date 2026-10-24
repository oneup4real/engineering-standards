# Architecture review (`mid`)

Trigger: new folders or layers, changed imports across layers, new or changed server actions.
Read first: depcruise and arch-suite CI output. Do not re-run them.

## Checklist (what tools cannot decide)
- [ ] Write path is UI -> server action -> service -> adapter; no shortcut added.
- [ ] Every file under `src/server/` starts with `import 'server-only'`.
- [ ] Action returns the single contract `{ success: true, data? } | { success: false, error, code? }`.
- [ ] Every exported action guards the caller in its body (or carries an explicit public marker with reason); no unguarded helpers exported from actions.
- [ ] Business rule lives in a service or domain function, not in the action or component.
- [ ] Domain imports only domain and shared; ports are interfaces, adapters implement them.
- [ ] No entry added to a ratchet or baseline file.
- [ ] Docs for roles, collections, upload paths, scripts, CI are updated in the same change.
