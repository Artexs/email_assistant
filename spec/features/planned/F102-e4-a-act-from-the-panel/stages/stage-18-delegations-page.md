# F102 stage 18 — Delegations page

Part of [`../plan.md`](../plan.md). Read P6, D9, D11, D13, Q7, Q8, Q12 and [`../commands.md`](../commands.md). Needs stages 16 and 17 landed. New Polish text: the review uses `claude-opus-5-5`.

Two steps in `apps/web`.

## Step 1 — The page and the nav item

- **Goal:** with `delegation_pages` on, a member sees the delegations by state, and an owner reminds, cancels and marks them done.
- **Files:** a new page `apps/web/src/pages/delegations.astro`, a new island `DelegationsPage.tsx`, components under `apps/web/src/components/delegation/`, `nav-items.ts`, the API helper of stage 17, `en.ts` and `pl.ts`, unit tests.
- **Decisions:**
  - Nav (D11, Q8): item `delegations` (`/delegations`, label `nav_delegations`) after Approvals in the order of stage 12 while `features` holds `delegation_pages`. The phone keeps at most 5 tabs; the rest goes to the user menu.
  - The header tabs of stage 17 ("Delegations", "Delegates").
  - Filter tabs: Open, Overdue, Answered, Closed (the API filters; default Open). The choice is the `filter` query parameter, so a link keeps it.
  - Rows: one component per `item.kind`, chosen through a map from kind to component (only `delegation` now; E5b adds kinds and tabs to the same page). A row shows the delegate (name, address, Off when inactive), the task (or "—" when retention cleared it), the mail subject, the due date, the state, "Reminders: n of 2", and "A reminder waits for your approval" with a link to `/approvals` while `reminderWaiting`; a `drafted` row links its draft to `/approvals?id=<sendId>`.
  - Actions per state: Remind now (owner; `sent`, `overdue`; hidden while `reminderWaiting` or at 2 reminders); Done (any member, Q7; `answered`, `overdue`); Cancel (owner, Q12; `drafted`, `sent`, `overdue`) behind a confirm dialog "Cancel this delegation? It cannot be undone."
  - Answers: remind 200 → "Reminder planned. Approve it to send." with a link to `/approvals?id=<sendId>`; 409 codes → one short text each (`not_open`, `limit_reached`, `reminder_waiting`, `drafts_off` "Reminders need assist mode with drafts on.", `delegate_inactive`); done 409 `already`, `not_closable`; cancel 409 `sending` "The mail is being sent now." and `not_open`. Each answer reloads the list.
  - "Show more" loads the next page with the `next` cursor. The list reloads every 30 s while the tab is visible, keeping the loaded pages.
  - A member and a suspended organization see only Done (member) or no buttons (suspended).
- **Test** (unit):
  - T1: the nav order and the 5-tab limit for each combination of `approvals_page`, `delegation_pages` and `stats_page`.
  - T2: the action list per state and role equals the table above (every `DelegationStatus`).
  - T3: the kind map has a component for every `DelegationItem.kind`.
- **Done when:** T1–T3 pass; the typecheck passes.

## Step 2 — e2e

- **Goal:** the page works end to end.
- **Files:** a new `apps/web/e2e/tests/delegations.spec.ts`; the e2e seed (one delegation per state of the stage 15 T1 list, the mailbox in `assist` with drafts on).
- **Test** (e2e, `desktop` and `mobile`):
  - T4: Open shows the `sent` and `drafted` rows; the `drafted` row links to `/approvals?id=`.
  - T5: Overdue → Remind now → "Reminder planned."; after the reload the row shows "A reminder waits for your approval" and no Remind now button.
  - T6: Answered → Done → the row leaves the tab and shows under Closed.
  - T7: Cancel on the `sent` row, confirm → the row shows under Closed as cancelled.
  - T8: the member sees Done on the answered row and no Remind or Cancel.
  - T9: `/delegations?filter=closed` opens on Closed.
  - T10: `expectNoA11yViolations` on each filter tab and with the cancel dialog open.
  - T11: on `mobile` with the three flags on, the tab bar has 5 tabs: Activity, Approvals, Delegations, Mailboxes, Settings.
- **Done when:** T4–T11 pass; the full e2e suite passes.

## Done when (stage)

- Steps 1 and 2 hold. The web Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s18`); `web.log` shows `csp checked in 21 page(s)` (one more than before the stage).
