# UI review (`mid`; T1 batches may use `small` for the checklist)

Trigger: changes under component/page/style folders. Detail skill: `ui-consistency`; the project's UI catalog is the truth.
Read first: lint, style-ratchet and visual-regression CI output. Do not re-run them.

## Layers (imports only go down)
tokens -> primitives -> feature components -> pages. Ask of any new component: "does it know the domain?"
Yes = feature component, no = primitive.

## Checklist
- [ ] Tokens: raw values (hex, rgb/hsl, palette classes, arbitrary px like `text-[11px]`) exist only in the token layer (`@theme`). Missing step? Add a token, never a one-off value.
- [ ] Primitives: variants via `cva` (typed `variant`/`size`/`tone`), classes merged with `cn()`, tokens only, `data-ui` hook, exported, catalog entry, tests, visual-net entry.
- [ ] Feature components use primitives; no hand-built buttons, overlays (`fixed inset-0`) or duplicated components.
- [ ] `className` from the caller only for layout; no styling overrides of a primitive.
- [ ] Pages compose feature components and fetch via actions; no styling logic, no domain rules.
- [ ] The reuse table in the plan matches the diff (primitive reused vs new, with reason).
- [ ] Refactor of covered screens: zero-pixel diff against the baseline; reference images never updated to make a check pass.
- [ ] New page/modal/sheet has a visual-catalog entry.
- [ ] Accessibility: label for every control, focus visible, keyboard path, contrast from tokens.
- [ ] Empty, loading, error and long-text states exist.
- [ ] Ratchets and baselines (style, lint, depcruise) did not grow; they only shrink.
