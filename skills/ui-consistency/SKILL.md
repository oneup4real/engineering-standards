---
name: ui-consistency
description: Use before building or changing any UI in an existing app (components, pages, labels, pills, cards, spacing, typography). Enforces reuse of the project's primitives and design tokens instead of one-off styling.
---

# UI Consistency

An app looks designed when the same thing always looks the same. Agents break this because they style
what is in front of them, one screen at a time. This skill makes you look around first.

**Inside an existing app this skill wins over `frontend-design`.** Use `frontend-design` only for new
products or a redesign the human explicitly asked for.

## 1. Before writing UI: inventory

1. Read the project's UI catalog (`docs/UI_GUIDELINES.md`, or the "UI catalog" section in the project
   `AGENTS.md`). If none exists, say so to the human and propose creating one before adding new UI.
2. List the primitives folder (usually `src/components/ui/`) and read the props/variants of anything
   that could fit.
3. Search for an existing implementation of what you are about to build:
   `grep -rn "<the concept, e.g. Pill|Badge|StatusChip>" src/`. Look at two similar screens and match them.
4. In your plan, write a **Reuse table**: each UI element you will show → the primitive you will use, or
   "NEW: <reason nothing fits>".

## 2. While writing UI: rules

- **Tokens only.** Use the project's theme scale (`text-label`, `rounded-xl`, `p-4`, `bg-primary`).
  No arbitrary values (`text-[11px]`, `rounded-[18px]`, `p-[13px]`, `bg-[#0062e0]`) outside the
  primitives folder. If the scale lacks a step you need, stop and ask: the fix is a token, not a value.
- **Compose, don't restyle.** Feature code arranges primitives and passes variants. It does not rebuild
  a pill, button, card or header from `<span className="rounded-full px-2 …">`.
- **Same meaning, same look.** A status is always shown with the same component and variant. A section
  title always uses the same heading component. Check how the neighbouring screen does it.
- **New primitive only when nothing fits.** Put it in the primitives folder with typed variants,
  export it from the folder index, add it to the catalog in the same change, and replace any existing
  hand-built copies you touched.
- **Extend before you fork.** If a primitive almost fits, add a variant or prop. Don't copy it.

## 3. How primitives are built (reference stack)

Read `references/react-primitives.md` before creating or changing a primitive. In short:

| Concern | Standard |
|---|---|
| Layers | Tokens (`@theme`) → primitives (`components/ui`) → feature components → pages. Each layer uses only the one below. |
| Variants | `cva` (class-variance-authority) with typed `variant` / `size` props. Export `VariantProps` types. |
| Class merging | One `cn()` helper (`clsx` + `tailwind-merge`) in `src/lib/cn.ts`, so a layout `className` from outside can't create conflicting classes. |
| Interactive parts | Dialog, popover, dropdown, tabs, tooltip, select: Radix UI (or React Aria) is recommended, since it brings focus trap, ESC and ARIA. A project may keep its own implementation instead (note it in the UI catalog), but then there is exactly **one** per kind, in the primitives folder. Never a new overlay per feature. |
| Composition | `children` and compound components (`Card`, `Card.Header`, `Card.Body`) instead of many props. `asChild` (Radix `Slot`) when a primitive must render as a link. |
| Tokens | Named by role, not value: `text-label`, `bg-status-success`, `rounded-card`. Raw values only in the `@theme` block. |
| `className` from outside | Layout only (margin, width, grid placement). Colour, font size, radius and padding come from variants. |
| Refs | React 19: `ref` is a normal prop. No `forwardRef` in new code. |
| Exports | Every primitive exported from `components/ui/index.ts` and listed in the catalog. |

## 4. Changing existing UI without changing how it looks

When you move existing screens onto primitives or tokens, the result must look **identical**.

1. **Baseline first.** Before touching code, there must be visual regression screenshots of every affected
   screen (Playwright `toHaveScreenshot`, fixed viewport, fixed data, animations disabled). If there are none,
   stop and create them first. That is its own task.
2. **Tokens map 1:1 first.** A new token gets exactly the value it replaces (`--text-label-xs: 10px`).
   Merging two close values (10px and 10.5px) changes the look. That is a design decision for the human, done
   in a separate, explicitly approved change, never as part of a refactor.
3. **One primitive at a time.** Migrate one primitive across all its usages, run the screenshot suite, require
   zero diff, commit. Then the next.
4. **A diff is a failure, not a new baseline.** Never update snapshots to make a refactor pass. Find the
   differing class and fix the code. Only the human approves a snapshot update.

## 5. Before claiming done: self-check

- [ ] Every row of the Reuse table is implemented as written.
- [ ] `grep -nE "(text|rounded|p[xytrbl]?|m[xytrbl]?|gap)-\[" <changed files>` shows nothing outside the primitives folder.
- [ ] The project's style ratchet (`npm run test:arch` or equivalent) passes, and its count did not go up.
- [ ] New primitives are in the catalog.
- [ ] The changed screen matches its neighbours (same font sizes for same roles, same pill sizes,
      same spacing). Check in the browser or a screenshot when you can.
- [ ] Refactor of existing UI: the visual regression suite passes with zero diff and no snapshot was updated.

## Red flags

| Thought | Reality |
|---|---|
| "This label just needs to be a bit smaller" | Use the next token down, or ask for a new token. |
| "It's faster to write the span inline" | It's the 16th copy. Use the primitive. |
| "This screen is special" | Then the special variant goes into the primitive. |
| "There's no catalog, so anything goes" | Without a catalog, read the primitives folder and two neighbouring screens. |
