# F116 stage 22 — Delegate action, loop settings and consent button

Part of [`../plan.md`](../plan.md). Needs stage 20 and F104 stage 10 (the Sent switch on the mailbox card). New Polish text: the review uses `claude-opus-5-5`. Proof: the web tail of `plan.md` § Proof. Checkpoint C3 follows (a review of 15–22; not a stop).

## Step 1 — Delegate on a mail row

- **Goal:** with `delegate_button` on, an owner delegates a mail from the panel's mail list (the activity page rows) with a select of active delegates (PD-124).
- **Decisions:**
  - The action shows on rows of the categories of the Telegram rule (urgent, needs reply, unsure; questions.md 6), only for owners, only when the org has an active delegate and the mailbox is in `assist` with drafts on (from the data the page already loads plus `GET /delegates`).
  - Flow: "Delegate" → a dialog with a select (active delegates by name, the address under each) → `POST /emails/:id/delegate` → "Delegation drafted. Approve it to send." with a link to `/approvals?id=<sendId>`; 409 codes → one text each (`exists` links to the delegation).
- **Test (unit):** T1 the action shows for each category and role per the rule; T2 a fixed Polish value per new key.

## Step 2 — Settings card

- **Goal:** the mailbox settings card shows, under the F104 Sent switch: "Wait before a follow-up" (select 1–10 working days, default 3) and the switch "Draft follow-ups automatically" (default off), both only while `open_loops` is on.
- **Decisions:** both controls are disabled while `sentTracking` is not `on`, with the line "Turn on 'Track my sent mail' to use open loops." The wait help text: "Counted on working days (Monday to Friday)." The switch help text: "Drafts still wait for your tap before they go out."
- **Test (unit):** T3 the controls are hidden with the flag off and disabled with `sentTracking` `off`.

## Step 3 — Confirm the new Telegram terms

- **Goal:** a linked user whose consent is older than the current version sees on the Telegram card of the settings page "New Telegram terms: open loops" with the consent text and a "Confirm" button that calls `POST /api/telegram/consent` (stage 17).
- **Reuse rule:** when F115 stage 15 built this button, reuse it and only check that it shows the new text.
- **Test (unit):** T4 the button shows for an old version and not for the current one.

## Step 4 — e2e

- **Test (e2e, `desktop` and `mobile`):** T5 an owner delegates a `needs_reply` row → the dialog, a pick, the success text with the approval link; T6 a member sees no Delegate action; T7 the wait select set to 5 → saved after a reload; T8 the consent button → after the tap it is gone; T9 `expectNoA11yViolations` with the dialog open and on the settings page.

## Done when

T1–T9 pass; the Proof with the web tail prints `PROOF_OK` (`/tmp/f116-s22`); the final message names the `csp checked in` count.

## Out of scope

M2 (23), docs (24).
