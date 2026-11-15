# F102 stage 08 — Supersede [risky]

Part of [`../plan.md`](../plan.md). Read D1–D3, D12, D15, F4, F5 and [`../commands.md`](../commands.md). Needs stages 04 and 06 landed.

`[risky]`: exactly-once of a send; the delegation state. One step.

## Step 1 — `editApproval` and the superseded state [risky]

- **Goal:** an edit replaces a waiting send by a new version in one transaction; the old version can never be approved.
- **Files:** module `actions` (a new file for `editApproval`), the two `DelegationHooks` members in `delegation`, the tap answer in `channels`, tests.
- **Interfaces** (`commands.md`):
  - `ApprovalDeps` gains `approvalHooks: ApprovalHooks` (the type and `noApprovalHooks` only; calls come in stage 09); `editApproval(deps, ctx, sendId, input)`.
  - `DelegationHooks.onSuperseded` and `DelegationHooks.activeDelegate`.
  - `ApproveResult`, `RejectResult` gain `superseded` + `currentId` (the newest version through `supersedes_action_id`).
  - `ApprovalInput.via` adds `"web"` (D15). Audit `action.edited`, data `{ previous_action_id, version, delegate_changed, via }`; never text.
- **Decisions:**
  - First statement: share-lock the mailbox settings row (the M13 rule of the chaser and `saveTriage`), then lock the old send, its draft, the delegation. Mode not `assist`, or switch `create_draft` off → `drafts_off`.
  - The old send must be `awaiting_approval`; else `changed` (a newer version exists) or `closed` with its state.
  - Kind `reminder` → `not_editable`. A `delegateId` on another kind → `ValidationError` (400 `validation`, field `delegateId`). For kind `delegation`, `activeDelegate` gives the new name and address; undefined (inactive, or another organization) → `delegate_inactive`.
  - Clean with `cleanUserText`; over a limit after cleaning → `ValidationError`. Same subject, body and delegate as the current built message → `unchanged`.
  - New draft = old payload + `version` (old + 1), `subject_text`, `body_text`; a new delegate also sets `to`, `delegate_id`, `delegate_name`. New send = old send payload with the new `to`, `delegate_id`. Statuses `ready` and `awaiting_approval`; keys `<old draft id>:edit`, `<old send id>:edit`; `supersedes_action_id` on both.
  - Old send → `expired` / `superseded`, `result_notified_at` = now. Old draft → `closeDraftOfSend` with the existing reason `expired` (no new value in the reverse payload, `markUndone` or the `undone` edge): `ready` → `expired`; `applied` + UIDPLUS → reverse row; `applying` → the APPEND path closes it (F5). Without UIDPLUS the old copy stays (as reject today); the detail says so (`draftRemovable`, stage 10).
  - Delegation: `onSuperseded` sets `draft_action_id`, `send_action_id`, `delegate_id` while `drafted`; else roll back, `closed`.
  - D12: metrics that read expired or rejected sends skip `superseded` (name each one checked).
  - A Telegram tap on a superseded send answers `taps.changed`.
- **Test** (integration; O1, owner U1, delegates Anna `anna@example.com` and Piotr `piotr@example.com`, mailbox `assist` with `create_draft` on, delegation send S1 with applied draft D1, UIDPLUS on, `2026-11-20T13:05:00Z`):
  - T1: edit S1 (subject `Budget 2027`, body `Hello Anna,\r\nplease send the report.\n\nAdam`, via `web`) → `edited`; S2 `awaiting_approval`; D2 `ready`, `version` 2, `body_text` `Hello Anna,\nplease send the report.\n\nAdam`; S1 `expired` / `superseded` with `result_notified_at`; delegation `drafted` with D2, S2; one `action.edited` row.
  - T2: one committer tick after T1 deletes D1's copy (the fake provider gets `deleteMessage` for D1's UID); D1 `undone`.
  - T3: a second edit of S1 → `changed`, `currentId` S2. Edit S2 while D2 is `ready` → S3 `version` 3, D2 `expired` / `send_closed`, no reverse row.
  - T4: `approve(S1)`, `reject(S1)` → `superseded` with the newest id; S1 unchanged.
  - T5: an `approved` send → `closed`; a reminder → `not_editable`; same text and delegate → `unchanged`; Piotr disabled → `delegate_inactive`; a `delegateId` on a clarification → `validation`.
  - T6: delegate Piotr, same text → `edited`; S2 `to` `["piotr@example.com"]`; the delegation's `delegate_id` = Piotr.
  - T7: a clarification send → `edited`, no `onSuperseded` call.
  - T8: two edits of S1 at once → one `edited`, one `changed`.
  - T9: mode `shadow` → `drafts_off`; a setter that switches to `shadow` during an edit waits for it, then expires S2 (`policy_changed`) as today.
  - T10: UIDPLUS off → `edited`, no reverse row for D1.
  - T11: no result notice for S1; `actions.expiry` leaves S1 alone; a tap `ap:<S1>` answers `taps.changed`.
- **Done when:** T1–T11 pass; the transition tests (new reason and insert entries) and the completeness test pass.
- **Out of scope:** routes (10, 11); `onDecided` calls (09); the PD-076 hash check (E6a).

## Done when (stage)

- Step 1 holds. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s08`).
