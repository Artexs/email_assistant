# F172 stage 04 — Visual fixes from the review

Needs stage 03: the `fix` rows of `visual-review.md` and the sheet folder it names. Needs the mockup shots in `design/` (stage 05 deletes them) to check each fixed row. Runs alone: its fixes may touch any page. Timeout 150 min. Sonnet review before the land.

Part of [`../plan.md`](../plan.md). Decisions D6, D9, D10.

## Step 1 — Fix each `fix` row

- **Do:** for each `fix` row of both tables, change the token use, pattern prop, class or spacing value, up to about 100 lines per difference. One commit per row or per pattern; the row's verdict becomes `fixed` with the commit.
- **Token values:** a token value change follows ADR 0037 first (DB-3: the contrast rule wins over the mockup), and the a11y scans must still pass. A changed token row in the ADR goes in the same commit.
- **Too big:** a row that needs more than about 100 lines, or an API change, becomes `proposal` with one line for a follow-up ticket (D6). Write why in the row.
- **Guards:** the guards of stages 01 and 02 must still pass (no new stock shadow, no unused file or token, the allow lists match the ADR).

## Step 2 — The no-organization card

- **Default (owner to confirm, questions.md 11):** the sheet gets no new state, so the e2e seed does not change. Take its pictures with one throwaway Playwright script outside the repository (`/tmp/f172-04/`): sign in as the `main` state user and answer `/api/me` with no organization through `page.route`, as `apps/web/e2e/tests/account.spec.ts` changes that answer. Phone light and desktop dark, English and Polish.
- **Do:** save the pictures into the sheet folder under `no-organization-*.png`. Check the card against the page head and the card pattern (one `h1`, the card border in dark, the teal button). Set the verdict of its row: `ok`, `fixed` with the commit, or `proposal`.
- **Do not** commit the script.

## Step 3 — Sheet after the fixes

- **Do:** when step 1 or 2 fixed anything, run `bun run ui:sheet` again for the changed routes only (`UI_SHEET_ROUTES=<names>`) into the same folder. Check each `fixed` row once more against its mockup shot. A row that still differs goes back to step 1 once; after that it becomes `proposal`.

## Test

1. No row of `visual-review.md` keeps the verdict `fix`.
2. Every `fixed` row names a commit of this branch.
3. Every `proposal` row has one line for a follow-up ticket.
4. The `no-organization` row has a final verdict and the sheet folder holds its pictures.

## Out of scope

New features, new metrics (PB-7), a change of navigation names or the place of a control (PB-4). A new sheet state or e2e seed change. `docs/capabilities/web-panel.md` (stage 05). The docs site.

## Proof

`mkdir -p /tmp/f172-04 && bun run check:job > /tmp/f172-04/check.log 2>&1 && bun run web:build:dev > /tmp/f172-04/build.log 2>&1 && bun run test:e2e > /tmp/f172-04/e2e.log 2>&1 && echo PROOF_OK`

When the stage changed no product code (every row was `proposal` and the card was `ok`), the e2e run and `check:job` may be left out of the chain; say so in the final message.
