# F166 stage 05 — Primitives B

Part of [`../plan.md`](../plan.md). Needs: stage 04 (the pattern page, `Button`, `Card`). May run next to 06.

## Step 1 — Tabs and Alert

- **Files:** `components/ui/tabs.tsx`, `alert.tsx`; section files in `apps/web/src/dev/sections/`.
- **Decisions:** `Tabs` is the pill group of the mockup (`.tabsp`): a muted track, the active tab in the card colour with the card shadow, 44 px high, and it scrolls sideways inside itself when the tabs do not fit a phone (the page never scrolls sideways, DB-7). `Alert` gets the variant `accent` (the warm box, `.whybox`); `destructive` uses the destructive soft look; a bare text child still uses the full width (`apps/web/e2e/tests/alert-layout.spec.ts` must pass unchanged).

## Step 2 — Dialog, Sheet, DropdownMenu, Tooltip

- **Files:** `components/ui/dialog.tsx`, `sheet.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`; section files.
- **Decisions:** radius `xl` for a dialog and for the free corners of a sheet; the surface is `--card` with `--shadow-card`; the overlay stays `bg-black/50` (a scrim, allowed by the guard as an opacity of black: tell stage 07 by a line in the final message). A dialog on a phone is at most the screen height and scrolls inside. Menu items are 44 px high; the destructive item uses the destructive tokens. Motion is off under `prefers-reduced-motion` (DB-7).

## Step 3 — Table, Skeleton, Toaster

- **Files:** `components/ui/table.tsx`, `skeleton.tsx`, `sonner.tsx`; section files.
- **Decisions:** the table keeps its density (36 px rows; PB-11) and gets the tokens, a muted head row and radius on its wrapper; the skeleton uses `--muted` and radius `md`; the toast uses `--card`, `--shadow-card`, radius `lg` and follows the system scheme. Find out what `next-themes` does in `sonner.tsx`: if the toast is its only user and the system scheme works without it, write that in the final message (the dependency goes in the cleanup ticket, not here: DB-1).

## Test

1. Existing component tests and e2e specs pass with no edit of a selector.
2. `apps/web/e2e/tests/patterns.spec.ts` (from stage 04) also opens one dialog, one sheet and one menu on the pattern page and scans each with `expectNoA11yViolations({ include: … })` in both schemes.
3. On the Pixel 7 project, the pattern page has no sideways scroll with six tabs in one `Tabs` group (assert `scrollWidth <= clientWidth` on `html`).
4. With `reducedMotion: "reduce"` the dialog opens with `document.getAnimations().length === 0`.

## Out of scope

A new primitive from the CLI (a page ticket asks for it when it needs one). Feature components.

## Done when

You opened the pattern page pictures (phone and desktop, both schemes) and one real dialog in the sheet (for example the connect dialog of mailboxes) next to the mockup; the Proof of `../plan.md` (stages 03–06) prints `PROOF_OK`.
