# F110 stage 13 — Autonomy card with three evidence sources

Part of [`../plan.md`](../plan.md). Web stage (Proof with the web part). Polish text: review by `claude-opus-5-5`.

## Step 1 — The card reads the trust view

- **Goal:** the Settings card shows, per category, why `auto` may or may not be on (ADR 0028; E4 cross-check row "Autonomy per category").
- **Files:** `apps/web/src/components/settings/CategoriesCard.tsx` and `SetAnywayDialog.tsx`; page keys in `en.ts` and `pl.ts`.
- **Decisions:**
  - With `trust_ladder` on (the view answers 200), each category row shows: the switch (as today); `Proof: 99.1% on 200 test cases` (the `wilsonLower` as a percent with one decimal, and `cases`) or `No proof for this AI model yet` (`none`) or `Not proven (<percent>)` (`no-go`), with `(provisional)` when set; `Your mail: passed` / `would hide mail you needed (<moved> of <acted>)` / `not enough history` / `not checked yet`; and a red line when tripped (`Paused: <reason phrase>`). Real labels show only when `kept ≥ 30`, as today's precision text.
  - With the flag off (404), the card is exactly as today.
  - Turning a switch on that is refused opens `SetAnywayDialog` with the block list as text lines (one fixed phrase per `EvidenceBlock`). Confirm sends `force: true` (as today).
  - A link `See the report` to `/report?mailbox=<id>` under the card when a check exists.
  - Owner only can switch (as today); a member sees the same lines, switches disabled.
- **Test:**
  1. Unit (component test pattern of the repo, if one exists; else e2e only): a fixture view with `notification` eligible, `spam` blocked `history_fail`, `info` tripped → the three lines show the right phrases.
  2. e2e (extend the Settings spec): flag on, seeded check and fixture gate dir → the lines show; turning `spam` on opens the dialog with "would hide mail you needed"; confirm → the switch is on.
  3. e2e: flag off → no evidence lines.
  4. `expectNoA11yViolations(page)` on the Settings page with the card open and with the dialog open.
  5. Keyboard: Tab reaches each switch and the dialog's confirm and cancel buttons.

## Done when

- `en.ts` and `pl.ts` have the same keys (the typecheck enforces it).
- The e2e seed sets the gate directory through `GATE_EVIDENCE_DIR` to a fixture folder in `apps/web/e2e/` (no change to the committed gate files).
- Proof (`s13`, with the web part) prints `PROOF_OK`.

## Out of scope

The report page (stage 14). Changes to the gate logic (stage 04).
