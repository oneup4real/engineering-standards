# Architecture review (`mid`)

Trigger: new folders or layers, changed imports across layers, new or changed server actions.
Read first: depcruise and arch-suite CI output. Do not re-run them.

## Layers
Presentation (`app`, `components`) -> boundary (actions) -> services -> adapters; domain and shared below. Imports go down only.

## Checklist (what tools cannot decide)
- [ ] Write path is UI -> server action -> service -> adapter; no shortcut, no database write from UI code.
- [ ] Every file under `src/server/` starts with `import 'server-only'`; the UI never imports from it.
- [ ] Action returns the single contract `{ success: true, data? } | { success: false, error, code? }`; errors do not leak `error.message`.
- [ ] Every exported action guards the caller in its body (or carries an explicit public marker with reason and a rate limit); validates input with a schema; no unguarded helpers exported from actions.
- [ ] Identity, roles, owners, prices and recipients are resolved on the server, never taken from the client.
- [ ] Business rule lives in a service or domain function, not in the action or component.
- [ ] Domain is pure: imports only domain and shared; ports are interfaces, adapters implement them.
- [ ] No cross-layer import added (feature to app, service to action, domain to server).
- [ ] No entry added to a ratchet or baseline file.
- [ ] Docs for roles, collections, upload paths, scripts, CI are updated in the same change.
