# F166 stage 04 — Primitives A: buttons, cards, badges, fields

Part of [`../plan.md`](../plan.md). Needs: stage 03 (tokens); stage 08 (the pattern page and its spec); the mockup in the repo (`design/ui-proposals/proposals/03-pebble/`). May run next to 05, 06, 07, 09, 10.

## Step 1 — Button, Card, Badge

- **Files:** `components/ui/button.tsx`, `card.tsx`, `badge.tsx`; one section file each in `apps/web/src/dev/sections/`.
- **Decisions:** D5; `../interfaces.md` § Primitives. The primary button has the soft coloured shadow of the mockup (`.btn.primary`). Every interactive size has the focus ring of `../interfaces.md` § Focus. `Card` gets a border under `forced-colors: active` (DB-7).
- **Test:** (1) existing component tests pass with no edit. (2) The button section shows each variant × size; the default button is 48 px high and `xs` is 36 px (read the computed height in a render or e2e check of your own file, not in `patterns.spec.ts`).

## Step 2 — Input, Textarea, Select, Switch, Label

- **Files:** `components/ui/input.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`, `label.tsx`; section files.
- **Decisions:** fields are 48 px, 16 px text (no zoom on focus in iOS), 2 px edge in `--input`, radius `md`; the invalid state keeps its `aria-invalid` styling with the destructive tokens; the switch is 52 × 30 px with a track in `--input` when off and `--primary` when on. A compact field size that a file already uses (`h-7`, `h-8`) becomes 36 px; list those call sites in the final message for the page tickets.
- **Test:** (3) the generic spec of stage 08 passes with the new sections in both schemes. (4) `SelectTrigger` `sm` and an input with a compact class are 36 px high.

## Out of scope

Tabs, dialogs, menus, tables, alerts, toasts (stage 05). Patterns (stages 06, 09, 10). `patterns.spec.ts` and any file of another stage of this wave. Any feature component: if a page breaks because of a size change (an overlap, a cut text), record it for its page ticket and fix it only when an e2e spec fails.

## Done when

`UI_SHEET_ROUTES=patterns bun run ui:sheet` shows the sections; you opened the phone and desktop pictures in both schemes next to the mockup shots `approvals-*` and `settings-*`; Proof B of `../plan.md` prints `PROOF_OK`.
