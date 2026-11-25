# F172 stage 03 — The one visual review against the mockup: verdicts only

Needs stage 02: the pictures must show the swept code (no stock shadow, no removed variant). Needs the mockup shots in `design/ui-proposals/proposals/03-pebble/shots/` (stage 05 deletes them). Changes no product code: it writes `visual-review.md` only. Timeout 150 min. No review job (no code).

Part of [`../plan.md`](../plan.md). Decisions D5, D6, P1.

## Step 1 — The full contact sheet

- **Do:** `bun run web:build:dev`, then `bun run ui:sheet` with no `UI_SHEET_ROUTES` (every route × phone and desktop × light and dark × English and Polish × organization state). It writes to `~/.local/share/email-assistant/ui-sheet/<job id>/` with `index.html`. Write the run time in `visual-review.md`.
- **Keep:** this folder is the owner's full sheet (PB-12). Write its path at the top of `visual-review.md`. The coordinator keeps it until the release lands. Stage 04 adds its later shots to the same folder.

## Step 2 — Compare the 12 drawn screens

- **Input:** the 48 mockup shots (12 screens: login, approvals, review, rules, mailboxes, settings, activity, stats, report, onboarding, delegations, empty; each phone and desktop, light and dark). No deferred list exists; the page tickets checked their pictures only in part.
- **Do:** open each mockup shot and the sheet picture of the same route, size and scheme (English, the organization state closest to the drawing; `empty` is the empty organization state). Check: colours and their roles, radius, shadow, font and text sizes, control heights, spacing rhythm, the page head, the card and row patterns, the sidebar and tab bar, the category pills.
- **Verdict per shot** (D6), one row each in the mockup table of `visual-review.md`:
  - `match`;
  - `accepted` with the decision that names the difference (PB-4 the control stays on its page, PB-7 a cut item with no data, PB-8 voice, DB-1 no API change, PB-10 dark follows the system);
  - `fix` with the difference in one line, the file or pattern it lives in, and a size guess (lines);
  - `proposal` with one line for a follow-up ticket (a layout or flow change of more than about 100 lines, or one that needs an API change).

## Step 3 — The undrawn pages and states

- **Do:** read every other sheet route once in phone light and desktop dark, English, and one Polish pass of each route in phone light. Look for: a stock look left (a grey square card, a 36 px button, a stock focus ring, a palette colour), sideways scroll at phone width, a text cut off, a second `h1`, a card with no border in dark, an emoji.
- **Verdict:** one row per route in the route table of `visual-review.md`: `ok`, `fix` (as above) or `proposal`.
- **The no-organization card:** the sheet has no state for it. Add a row `no-organization` to the route table with the verdict `checked in stage 04`; stage 04 takes its picture.

## Test

1. The mockup table has 48 rows, each with one of `match`, `accepted`, `fix`, `proposal`.
2. Every `accepted` row names a decision id.
3. Every `fix` row names a file or pattern.
4. The route table has one row for each route of `apps/web/e2e/ui-sheet/routes.ts`, plus the `no-organization` row.
5. `git diff --name-only master` lists only files of the ticket folder.

## Out of scope

Any code change (stage 04). New features, new metrics (PB-7), a change of navigation names or the place of a control (PB-4). The docs site and the docs shots.

## Proof

`mkdir -p /tmp/f172-03 && bun run web:build:dev > /tmp/f172-03/build.log 2>&1 && bun run ui:sheet > /tmp/f172-03/sheet.log 2>&1 && ls spec/features/active/F172-*/visual-review.md > /tmp/f172-03/review.log 2>&1 && echo PROOF_OK`

The worker writes the result of Test 1–5 in the final message, one line each, with the row counts.
