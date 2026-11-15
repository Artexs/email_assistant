# F116 stage 21 — "Open loops" page

Part of [`../plan.md`](../plan.md). Needs stage 20 and F102 stage 18 (the delegations page). New Polish text: the review uses `claude-opus-5-5`. Proof: the web tail of `plan.md` § Proof.

## Step 1 — Tabs and rows

- **Goal:** with `open_loops` on, the F102 page `/delegations` is "Open loops" with tabs Delegated · Waiting · Promised (PD-126); with the flag off it stays as F102 built it.
- **Decisions:**
  - Nav label `nav_open_loops` ("Open loops" / "Otwarte sprawy") replaces `nav_delegations` while the flag is on; the URL stays `/delegations`; `?tab=waiting|promised|delegated` (default `delegated`) and the F102 `filter` stay in the URL. The Delegates header tab of F102 stays.
  - Delegated tab: the F102 list, then a second list "Tracked from your sent mail" / "Z Twojej wysłanej poczty" from `GET /loops?kind=delegated`. Waiting and Promised tabs: `GET /loops?kind=…`; filters Open, Due today, Closed.
  - Rows: one component per loop kind through the F102 kind-to-component map. A loop row shows the counterpart (or the delegate's name), the `text` (else the subject; "—" after retention), the reason line (en "You asked a question; no answer for 4 working days", pl "Pytanie bez odpowiedzi od 4 dni roboczych"), the due date with "stated" or "default", "Follow-ups: n of 2", "matched by subject" on a `replied_subject` row, "auto-reply only".
  - Actions per state and role (D11): Draft follow-up (owner; open waiting or delegated; hidden while a follow-up waits; then "A follow-up waits for your approval" with a link to `/approvals?id=<sendId>`), Later (member; hidden at 0 left), Done (member), Drop (owner), Untrack (owner; delegated), Reopen (owner; closed rows with text). Drop and Untrack open a confirm dialog.
  - Answers: one short text per 409 code of stage 20; each answer reloads the list; the 30 s reload of F102 applies.
  - Polish texts are gender-neutral (no "Zadałeś").
- **Test (unit):** T1 the action list per kind, state and role equals the rules above (a table test over every `status` and `close_reason`); T2 the kind map has a component for every `LoopItem.kind`; T3 the nav label with the flag on and off; T4 a fixed Polish value for each new key.

## Step 2 — e2e

- **Goal:** the page works end to end (`desktop` and `mobile`).
- **Files:** `apps/web/e2e/tests/open-loops.spec.ts`; the e2e seed gets one loop per kind and state, the mailbox in `assist` with drafts on, the flag on.
- **Test (e2e):** T5 Waiting → Draft follow-up → "Follow-up drafted" and the approval link; T6 Later → the due moves; T7 Promised → Done → the row moves to Closed; T8 Delegated shows both lists; Untrack with confirm → Closed; T9 a member sees Later and Done only; T10 `/delegations?tab=promised` opens on Promised; T11 `expectNoA11yViolations` on each tab and with a dialog open; T12 the flag off → the F102 page unchanged (its e2e passes).

## Done when

T1–T12 pass; the Proof with the web tail prints `PROOF_OK` (`/tmp/f116-s21`); the final message names the `csp checked in` count.

## Out of scope

The Delegate action on mail rows and the settings card (22).

## Carry-over from stage 08 review

- Same as stage 20: `listLoops` shape (`now`, decoded cursor, encoded `next`) and the midnight edge between `listLoops` and `briefLoopsOf` (review-8.md N3).
