# F168 stage 04 — The queue decision flow `[risky]`

Needs stage 01: `ApprovalCard`, `WaitingList`. Needs stage 02: `reply-panel.spec.ts` (shared file). Needs stage 03: `lib/approvals-queue.ts`. Needs F166 stage 10: `StickyActions`. Needs F166 stage 06: `StepDots`. May run next to 07, 08.

Part of [`../plan.md`](../plan.md): P1–P9, D3–D6, D9. It sends mail to people: an Opus review before the land.

## Step 1 — The page runs the queue

- **Files:** `islands/ApprovalsPage.tsx`, `components/approvals/ApprovalActions.tsx`, `i18n/texts/*-approvals.ts`, `e2e/tests/approvals.spec.ts`, `reply-panel.spec.ts` (only the tests that pick from the list), `docs/capabilities/web-panel.md` (the approvals rules). The approvals seed (`args-approvals.ts`) may get more sends; then update the `E2E_APPROVALS_*` constants and their readers.
- **Page modes:** `loading`, `empty`, `focus` (waiting or held), `closed` (P6), `end` (P5).
- **Decision bar:** `StickyActions` holds "Yes, send it", "Change", "No", with today's rules (`decisions()`, `canEdit`, `draftReady`, gaps, owner only). A member or a paused organization sees `owner_only` there. The progress row above the card: `StepDots` with `progress()`, "Later" (`ghost`, `xs`), and below `lg` "All waiting (n)", which opens a `Sheet` with the `WaitingList` (P9).
- **Outcomes (P3, P4):**

  | Result | Card shows | Then |
  | --- | --- | --- |
  | approve 200; detail `sent`, `sending`, or `held` with no cause | "Sent to {to}", else "Sending to {to}" (punycode) | next after `SENT_HOLD_MS` |
  | approve 200; detail `held` with a cause | `appr_done_held` with the cause | next after the hold |
  | approve 200; detail `failed` or unreadable | `appr_done_failed` / `appr_done_unknown` | "Next draft" button |
  | 409 `changed` with `currentId` | the newest version in place, `appr_changed` | — |
  | 409 `closed`, or 404 | the closed text / `appr_not_found` | next after the hold |
  | 409 `draft_not_ready`, `has_gaps`, `feature_off`; another error | the notice; the error `Alert` | stay; buttons on |
  | reject 200 | `appr_done_rejected`; the reason picker when `mistake_capture` is on | next after the hold, or after a pick or "Skip" |

  During a request and the hold every button is off, "Later" too. A handler takes the id of the card it rendered; a new card's decision buttons stay off until `armed()` (D3).
- **Events:**
  - `vanished()` after a reload: read the detail, show its closed text, add the id to `ownIds`, move on; `superseded` opens `currentId` in place (P7). A new draft joins the queue; the focus stays.
  - `expiredNow()`: "Yes" and "No" go off; read the detail (D9).
  - An edit, a redraft or a recipient change: the old id goes to `ownIds`, the focus to the new id.
- **URL, focus:** D4, D6; the end and empty pages have no `id`.
- **e2e** (`approvals.spec.ts`, both projects unless named):
  - Q1: with 5 waiting, "Yes" on the draft that `SEND_SCOPE=self` lets out shows "Sent to" or "Sending to" with the buttons off, then the next draft and "2 of 5".
  - Q2: a double click on "Yes", then `page.mouse.click` on the old "Yes" centre at once when the outcome shows and again when the next card shows: the next draft is still `waiting` (`page.request`), the list holds one item less.
  - Q3: "Later" shows the next draft and a new URL `id`; the skipped draft stays `waiting`.
  - Q4: `?id=` of a rejected draft: the closed card, its state text, "Go to waiting drafts". `?id=` of a superseded version: "Open the newest version" opens it.
  - Q5: `?id=` of the third waiting draft opens it first.
  - Q6: reject the focused draft with `page.request`, fire `visibilitychange` (the poll runs): the notice shows, the focus moves.
  - Q7 (`mobile`, viewport 412 × 600, a long draft): the three buttons lie inside the viewport, above the tab bar; "All waiting" opens the list.
  - Q8: axe scan of the focus, closed and end cards.
  - Set `SENT_HOLD_MS` and `ARM_MS` to 0 once and see Q2 fail.

## Out of scope

Shortcuts. Routes, the committer, the limits. Edits of `open-loops.spec.ts` or `delegations.spec.ts` (D5: a question). User docs, demo (stage 05).

## Done when

- Q1–Q8 and the earlier approvals tests that still apply pass.
- Contact sheet pictures of `approvals` read next to `02-approvals-*`.
- Proof of `../plan.md` with the specs `approvals.spec.ts reply-panel.spec.ts open-loops.spec.ts delegations.spec.ts` prints `PROOF_OK`.
