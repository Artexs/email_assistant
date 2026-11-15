# F102 stage 18: delegations page (notes for stages 19 and 20)

- Page: `/delegations` (`apps/web/src/islands/DelegationsPage.tsx`). Rows come from the kind map `components/delegation/delegation-kinds.ts`
  (only `delegation` now; E5b adds a kind there and a tab). Logic is in `lib/delegations-view.ts` (actions per state and role, the five
  remind blocks, answers of the server), `lib/use-delegation-list.ts` (pages and the 30 s reload) and `lib/use-delegation-filter.ts`
  (`?filter=`). Nav item `delegations` shows with the flag `delegation_pages`; the phone keeps 5 tabs, the rest goes to the menu.
- Remind now is NOT hidden when it cannot work (this differs from the stage text, as the job asked): the button stays in the tab order
  with `aria-disabled` and the reason text linked by `aria-describedby`. The row knows `not_open`, `limit_reached`, `reminder_waiting`
  and `delegate_inactive` itself. `drafts_off` (the mailbox setting is not on the row) is learned from the 409 and kept for the page
  life (a new tab or a page load clears it). The shared limit is `DELEGATION_REMINDER_LIMIT` in `packages/core/src/web/delegation.ts`;
  the server reads it too (`MAX_REMINDER_SENDS`).
- Done has no question (as the stage says); Cancel asks "Cancel this delegation?" and the focus starts on "Keep the delegation".
  Focus: after Remind, Done and Cancel answers the focus is on the status line (`role="status"`, `tabIndex=-1`); Keep or Escape returns
  it to the Cancel button of the row; "Show more" focuses the first new row.
- Polish: delegation = zlecenie, delegate = wykonawca, "Mark as done" = "Oznacz jako zrobione". The glossary test forbids "delegacj".
- Carry-over from stage 15 (done): `approveRow` now queues the `expired` card edit when a tap or a panel approve finds the send past its
  limit (`expireByTap` in `actions/approvals.ts`; the Telegram tapper is excepted, the panel has no card). The hourly expiry job still
  edits no card (accepted; stage 19: `docs/capabilities/drafts-and-send.md` already says so).
- Review 9 N1 (judged: real, fixed). A decision reads its clock before it waits for the send lock, so a later commit could carry an
  earlier time and `newerEditSent` dropped the correct row. `queueCardEdits` now gives a row `created_at` = max(decision time,
  newest edit row of the same card + 1 ms); `next_attempt_at` stays the decision time. Decisions on one send run one after the other
  (send lock), so the order of the rows is the order of the decisions. Test: "a decision that read its clock earlier but commits later
  still ends the card"; mutation log `/tmp/f102-s18/mut-s15-n1-created-at-order.log`. The other lock-order question of review 16 TG2 is
  untouched.
- e2e: one organization per project (`E2E Delegations <project>`, `e2e-delegations-rows.ts`): drafted, sent, overdue (remind), limit,
  inactive, answered (done), answeredMember, done, cancelled (task `[removed]`). The seed sets `last_reminder_at` on open rows, because
  the e2e server runs the chaser (a planned reminder changed the rows in a full run, first run failed T12 for that reason). The
  delegates organizations now hold a mailbox (`mailboxAddress` in the seed file) for the 400 `mailbox_address` browser test (T4c).
- Not verified: Firefox and WebKit (no Playwright project; mobile is Chromium emulation) for the focus after a row moves.
- Stage 20: the "Delegations" tab and the page both exist now, so the flag can go on for the pilot organization.
