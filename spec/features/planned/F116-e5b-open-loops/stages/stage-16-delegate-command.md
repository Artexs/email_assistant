# F116 stage 16 — Delegate command

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people). Needs stage 08 (the `delegations.source` column of stage 07).

## Step 1 — `delegateMail`

- **Goal:** `delegateMail(deps, ctx, { emailId, delegateId, userId, via })` in module `loops` (`interfaces.md`; `delegation` may not import `triage`, and `loops` may import both): the user picks a delegate for a mail and gets the existing delegation draft and approval (PD-124). It calls `delegation` for the row and the core planner for the pair; it adds no new delegation rule to `delegation`.
- **Decisions, in this order:**
  1. Flag `delegate_button` off → `feature_off`; the mail is not in the org → `not_found`; the user is not an owner → `not_allowed` (the route answers 403 before the call, stage 20; Telegram answers `taps.ownerOnly`, review N6).
  2. The delegate is not in the org → `not_found`; not active → `delegate_inactive`.
  3. The mail has a delegation in `drafted`, `sent` or `overdue` → `exists` with its id.
  4. The mail is not delegable → `not_delegable`: final category `spam`, any suspicious reason (`suspiciousReasonsOf`), the sender is an own mailbox, or the mail is a system mail (`X-EA-Action-Id`).
  5. Mode `shadow` or `create_draft` off → `drafts_off`.
  6. In one transaction, under the settings share lock (M13): plan the `create_draft` (kind `delegation`, `ready`) and the `send` (`awaiting_approval`) through the planner path triage uses today, with the delegate fixed; insert the `delegations` row (`drafted`, `source = button`) and link both payloads (the `saveTriage` rule of `delegation.md` rule 3). Keys `<email id>:create_draft:delegation:button:<k>` and `:send:…:<k>`, `k` = 1 + the count of this mail's `cancelled` button delegations (review G2); a repeat after a crash finds the open delegation → `exists`.
  - Task text (questions.md 8): the stored triage summary of the mail, else its subject, cut to the classifier's task length. No LLM call. Due: none stated → the existing 3-day rule at send.
  - The approval card, edit (F102, also the delegate change) and the send follow the existing path.
  - Audit `delegation.created` with `source` and `via`.
- **Test (integration):** T1 an `info` mail, an active delegate, `assist` → a pair and a `drafted` delegation with `source = button`, recipient = the delegate's address; T2 the same tap again → `exists`; T3 a spam mail → `not_delegable`; a mail with a suspicious reason → `not_delegable`; T4 shadow → `drafts_off`, no row; T5 a disabled delegate → `delegate_inactive`; T6 a delegate of org B → `not_found`; T7 a mail that triage already delegated (open) → `exists`; T8 after the send is applied → `sent` with a due 3 days later (the existing rule); T9 a rejected button delegation, then a new pick → a new pair and delegation (`k` 2).

## Check

`bun test apps/server/test/integration/<the touched delegation and loops tests>`

## Done when

T1–T9 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s16`).

## Out of scope

The Telegram button and picker (19), the panel action (22).
