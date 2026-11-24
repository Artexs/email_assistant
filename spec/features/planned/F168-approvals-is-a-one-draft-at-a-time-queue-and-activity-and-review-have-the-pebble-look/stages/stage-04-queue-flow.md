# F168 stage 04 — The queue decision flow `[risky]`

Needs stage 01: `ApprovalCard`, `WaitingList`. Needs stage 02: `reply-panel.spec.ts` (shared file). Needs stage 03: `lib/approvals-queue.ts`. Needs F166 stage 10: `StickyActions`. Needs F166 stage 06: `StepDots`. May run next to 06, 07, 08.

Part of [`../plan.md`](../plan.md): P1–P9, D3–D6, D9. It sends mail to people: Opus review before the land.

## Step 1 — The page runs the queue

- **Files:** `islands/ApprovalsPage.tsx`, `components/approvals/ApprovalActions.tsx`, `i18n/texts/*-approvals.ts`, `e2e/tests/approvals.spec.ts`, `reply-panel.spec.ts` (only the tests that pick from the list), `docs/capabilities/web-panel.md` (the approvals rules). The approvals seed may get more sends; then update `E2E_APPROVALS_*` and its readers.
- **Page modes:** `loading`, `empty`, `focus` (with `openedAs`), `closed` (`closedView`, P6), `end` (P5).
- **Decision bar:** `StickyActions` holds "Yes, send it", "Change", "No", with today's rules (`decisions()`, `canEdit`, `draftReady`, gaps, owner only); a member or a paused organization sees `owner_only` there. The progress row above the card: `StepDots` with `progress()`, "Later" (`ghost`, `xs`), and below `lg` "All waiting (n)", which opens a `Sheet` with the `WaitingList` (P9).
- **Outcome:** `outcomeOf()` decides. During the request and the hold the decision buttons and "Later" are off. The outcome line, the reason picker, "Next draft" and "Show them again" sit inside `StickyActions` in place of the three buttons (above the tab bar on a phone) and stay on. A handler takes the id of the card it rendered; a new card's decision buttons stay off until `armed()` (D3).
- **Events:**
  - The focus detail loads closed, or `vanished()`: show the closed text, add the id to `ownIds`, move on; `superseded` opens `currentId` in place (P7).
  - While the edit dialog or the reason picker is open, P7 and D9 wait. The dialog's own 409 and closed-send paths decide, as today; then the 409 `closed` row applies. `open-loops.spec.ts` S11 and `approvals.spec.ts` S13-N1, S13-TG2 check this.
  - A new draft in a reload joins the queue; the focus stays. `expiredNow()`: "Yes" and "No" off; read the detail (D9).
  - An edit or a recipient change: the old id goes to `ownIds`, the focus to the new id. A redraft that ends while the focus is on another draft does not move the focus (today's T8b): the old id goes to `ownIds`, and the new version joins the queue.
- **URL, focus:** D4, D6; the end and empty pages have no `id`. S13-T6 and T7 check the status-line focus during the hold, the title focus after the move.
- **e2e** (`approvals.spec.ts`, both projects unless named):
  - Q1: with 5 waiting, "Yes" on a draft to the self address (`SEND_SCOPE=self`): "Sent to" or "Sending to", buttons off, then the next draft and "2 of 5".
  - Q2: a double click on "Yes", then `page.mouse.click` on the old "Yes" centre at once when the outcome shows and again when the next card shows: the next draft is still `waiting` (`page.request`), the list holds one item less.
  - Q3: "Later" shows the next draft, a new URL `id`, the same "of 5"; the skipped draft stays `waiting`.
  - Q4: `?id=` of a rejected draft: the closed card, its state text, "Go to waiting drafts". `?id=` of a superseded version: "Open the newest version" opens it. An unknown uuid: "does not exist".
  - Q5: `?id=` of the third waiting draft opens it first; `?id=` of the held send shows only "No".
  - Q6: reject the focused draft with `page.request`, fire `visibilitychange`: a notice, the focus moves.
  - Q7 (`mobile`, viewport 412 × 600; `page.route` lengthens the body of the detail answer): the three buttons lie inside the viewport above the tab bar; after "No", the reason picker does too; "All waiting" opens the list.
  - Q8: "Later" on every draft shows the end card; "Show them again" brings back the first one.
  - Q9: axe scan: focus, closed, end cards.
  - Set both lock times to 0 once: Q2 fails.

## Out of scope

Routes, the committer, the limits. Edits of `open-loops.spec.ts`, `delegations.spec.ts`, `loops-panel.spec.ts` (D5: a question). The demo step (stage 05).

## Done when

- Q1–Q9 and the earlier approvals tests that still apply pass.
- Contact sheet pictures of `approvals` read next to `02-approvals-*`.
- Proof of `../plan.md` with the specs `approvals.spec.ts reply-panel.spec.ts open-loops.spec.ts delegations.spec.ts loops-panel.spec.ts` prints `PROOF_OK`.
