# UI review (`mid`; T1 batches may use `small` for the checklist)

Trigger: changes under component/page/style folders. Uses the `ui-consistency` skill and the project's UI catalog.
Read first: lint, style-ratchet and visual-regression CI output. Do not re-run them.

## Checklist
- [ ] Reuse table in the plan matches the diff: primitives reused, no duplicated component.
- [ ] No arbitrary style values or palette classes outside the primitives folder; tokens only.
- [ ] Classes combined with `cn()`; `className` only for layout.
- [ ] New primitive: variants via `cva`, exported, documented in the catalog, tested, in the visual net.
- [ ] New page/modal/sheet has a visual-catalog entry; refactor of covered screens has a zero-diff comparison. Reference images never updated to make a check pass.
- [ ] Accessibility: label for every control, focus visible, keyboard path, contrast from tokens.
- [ ] Empty, loading, error and long-text states exist.
- [ ] Baseline/ratchet files did not grow.
