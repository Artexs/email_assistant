# F102 stage 08 — Supersede [risky]

Part of [`../plan.md`](../plan.md). Read D1–D3, D12, D15, F4, F5 and [`../commands.md`](../commands.md). Needs stages 04 and 06 landed.

`[risky]`: exactly-once of a send; the delegation state. One step.

## Step 1 — `editApproval` and the superseded state [risky]

- **Goal:** an edit replaces a waiting send by a new version in one transaction; the old version can never be approved.
- **Files:** module `actions` (a new file for `editApproval`), the `onSuperseded` hook in `delegation`, the audit event, the tap answer in `channels`, tests.
- **Interfaces** (exact names in `commands.md`):
  - `editApproval(deps, ctx, sendId, input)`; `deps` = `ApprovalDeps` plus `approvalHooks: ApprovalHooks`.
  - `ApprovalHooks.onDecided(...)`, default `noApprovalHooks` (no-op; stage 09 wires the real one). `approve`, `reject`, `editApproval` call it in their transaction: `approved` / `approved_held` (caller passes `heldBy`), `rejected`, `changed`; `exceptUserId` = the user when `via` is `telegram`.
  - `ApproveResult` and `RejectResult` gain `superseded` + `currentId` (the newest version, found through `supersedes_action_id`).
  - `ApprovalInput.via`: `"telegram" | "cli" | "web"` (D15).
  - Audit event `action.edited`, data `{ previous_action_id, version, delegate_changed, via }`. Never subject or body text.
- **Decisions:**
  - Lock order: old send, its draft, delegation (as reject). The old send must be `awaiting_approval`; else `changed` (a newer version exists) or `closed` with its state.
  - Kind `reminder` → `not_editable`. A `delegateId` that is not an active delegate of this organization → `delegate_inactive`; only kind `delegation` takes it.
  - Clean with `cleanUserText`; over a limit after cleaning → `ValidationError` (400). Same subject, body and delegate as the current built message → `unchanged`.
  - New draft = old payload + `version` (old + 1), `subject_text`, `body_text`; a new delegate also sets `to`, `delegate_id`, `delegate_name`. New send = old send payload with the new `to`, `delegate_id`. Status `ready` and `awaiting_approval` (the old send was waiting; a later policy change expires it as today, `policy_changed`); keys `<old draft id>:edit` and `<old send id>:edit`; `supersedes_action_id` on both.
  - Old send → `expired` / `superseded`, `result_notified_at` = now. Old draft → `closeDraftOfSend`, reason `superseded` (`ready` → `expired`; `applied` + UIDPLUS → reverse row; `applying` → F5).
  - Delegation: `onSuperseded` sets `draft_action_id`, `send_action_id`, `delegate_id` while `drafted`; any other state → roll back and answer `closed`.
  - `transitions.ts`: the new reason and insert entries (its tests tell where).
  - D12: metrics that read expired or rejected sends skip `superseded` (name each one checked).
  - Telegram tap on a superseded send: answer `taps.changed` (stage 05), no edit of the tapped card.
- **Test** (integration; fixed values: org O1, owner U1, delegate Anna `anna@example.com`, delegate Piotr `piotr@example.com`, delegation send S1 with applied draft D1, UIDPLUS on, now `2026-11-20T13:05:00Z`):
  - T1: edit S1 (subject `Budget 2027`, body `Hello Anna,\r\nplease send the report.\n\nAdam`, via `web`) → `edited`, new S2 `awaiting_approval`, D2 `ready` with `version` 2 and `body_text` `Hello Anna,\nplease send the report.\n\nAdam`; S1 `expired` / `superseded` with `result_notified_at`; one reverse row for D1; delegation `drafted` with D2 and S2; one `action.edited` audit row with `via` `web`.
  - T2: a second edit of S1 → `changed`, `currentId` S2; no new row.
  - T3: edit S2 while D2 is still `ready` → S3 `version` 3; D2 `expired` / `send_closed`; no reverse row for D2.
  - T4: `approve(S1)` and `reject(S1)` → `superseded`, `currentId` = the newest; S1 unchanged.
  - T5: edit of an `approved` send → `closed`; of a reminder → `not_editable`; same text and delegate → `unchanged`; an inactive delegate or one of another organization → `delegate_inactive`.
  - T6: delegate change to Piotr with the same text → `edited`; S2 `to` = `["piotr@example.com"]`; the delegation `delegate_id` = Piotr.
  - T7: a `clarification` send → `edited`; no `onSuperseded` call.
  - T8: two `editApproval` calls on S1 at once → one `edited`, one `changed`.
  - T9: no result notice for S1; `actions.expiry` leaves S1 alone.
  - T10: `onDecided` is called once with `changed` for T1, with `approved` for a web approval, and with `exceptUserId` U1 for a Telegram approval by U1.
  - T11: a tap `ap:<S1>` after T1 answers the `taps.changed` text.
- **Done when:** T1–T11 and the transition and completeness tests pass.
- **Out of scope:** routes (10, 11); card edits (09); the PD-076 hash check (E6a).

## Done when (stage)

- Step 1 holds. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s08`).
