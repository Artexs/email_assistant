# F172 stage 03 — The one visual review against the mockup

Needs stages 01 and 02: the pictures must show the swept code (no stock shadow, no removed variant). Needs the mockup shots in `design/ui-proposals/proposals/03-pebble/shots/` (stage 04 deletes them). Runs alone: its fixes may touch any page. Timeout 150 min.

Part of [`../plan.md`](../plan.md). Decisions D5, D6, P1.

## Step 1 — The full contact sheet

- **Do:** `bun run web:build:dev`, then `bun run ui:sheet` with no `UI_SHEET_ROUTES` (every route × phone and desktop × light and dark × English and Polish × organization state). It writes to `~/.local/share/email-assistant/ui-sheet/<job id>/` with `index.html`.
- **Keep:** this folder is the owner's full sheet (PB-12). Write its path in `visual-review.md`. The coordinator keeps it until the release lands.

## Step 2 — Compare the 12 drawn screens

- **Input:** the 48 mockup shots (12 screens: login, approvals, review, rules, mailboxes, settings, activity, stats, report, onboarding, delegations, empty; each phone and desktop, light and dark). No deferred list exists (no `notes/2026-11-25-pebble-visual-review.md`; the programme page has none). The page tickets F166–F170 checked their pictures only in part.
- **Do:** open each mockup shot and the sheet picture of the same route, size and scheme (English, the organization state closest to the drawing; `empty` is the empty organization state). Check: colours and their roles, radius, shadow, font and text sizes, control heights, spacing rhythm, the page head, the card and row patterns, the sidebar and tab bar, the category pills.
- **Verdict per shot** (D6), one row each in `visual-review.md`: `match`; `accepted` with the decision that names the difference (PB-4 the control stays on its page, PB-7 a cut item with no data, PB-8 voice, DB-1 no API change, PB-10 dark follows the system); `fixed` with the commit; `proposal` with one line for a follow-up ticket.
- **Fix in this stage:** a difference of a token use, a pattern prop, a class or a spacing value, up to about 100 lines per difference. A token value change follows ADR 0037 first (DB-3: the contrast rule wins over the mockup), and the a11y scans must still pass.
- **Proposal, not a fix:** a layout or flow change of more than about 100 lines, or one that needs an API change. It does not block the release (D6).

## Step 3 — The undrawn pages and states

- **Do:** read every other sheet route once in phone light and desktop dark, English, and one Polish pass of each route in phone light (long Polish words break layouts first). Look for: a stock look left (a grey square card, a 36 px button, a stock focus ring, a palette colour), sideways scroll at phone width, a text cut off, a second `h1`, a card with no border in dark, an emoji.
- **Verdict:** one row per route in a second table of `visual-review.md`: `ok`, `fixed` with the commit, or `proposal`. Known open item to check: the no-organization card (F167 review note N6 left it to this sweep).

## Step 4 — Sheet after the fixes

- **Do:** when step 2 or 3 fixed anything, run `bun run ui:sheet` again for the changed routes only (`UI_SHEET_ROUTES=<names>`) into the same folder, and check each fixed row once more.

## Test

1. `visual-review.md` has 48 rows in the mockup table, each with one of the four verdicts.
2. Every `accepted` row names a decision id.
3. Every `fixed` row names a commit of this branch.
4. The route table has one row for each route of `apps/web/e2e/ui-sheet/routes.ts`.

## Out of scope

New features, new metrics (PB-7), a change of navigation names or the place of a control (PB-4). The docs site and the docs shots (F171).

## Proof

`mkdir -p /tmp/f172-03 && bun run check:job > /tmp/f172-03/check.log 2>&1 && bun run web:build:dev > /tmp/f172-03/build.log 2>&1 && bun run test:e2e > /tmp/f172-03/e2e.log 2>&1 && echo PROOF_OK`

When the stage fixed nothing, the e2e run may be left out of the chain; say so in the final message.
