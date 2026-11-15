# F115 stage 05 — Lifetime and approval rules

Part of [`../plan.md`](../plan.md). Needs 04.

Gives the reply kind its 7-day life, the gap rule, the flag rule, and the shared functions that later stages call: `approvalExpiresAt`, `replaceApproval`, `closeSend`.

## Step 1 — Time limit per kind

- **Goal:** `approvalExpiresAt(kind, row)` in `actions` is the one rule for the claim, `approveRow`, the expiry job and the F102 `expiresAt` of `ApprovalItem`.
- **Decisions:** D11. `reply`: `awaiting_approval` ends at `created_at + 7 days` (reason `timeout`), whatever `notified_at`; the expiry reasons `not_notified` and `not_seen` skip replies. Held (`approved`): `approved_at + 48 h` for every kind (today's rule). Other kinds: unchanged.
- **Test (integration, fixed clock):**
  1. A reply send created 6 d 23 h ago, never notified → the expiry job keeps it; at 7 d 1 min → `expired` / `timeout`.
  2. A delegation send notified 49 h ago → `expired` / `timeout` (unchanged).
  3. A tap on a reply at 7 d 1 min → `expired`; at 6 days → approved.
  4. `GET /approvals` item of a reply → `expiresAt` = `created_at + 7 d`.

## Step 2 — Gaps and the flag

- **Goal:** `approveRow` refuses a reply whose effective body (`body_text ?? body`) holds `[[` → result `{ kind: "has_gaps" }`; the committer refuses the same at the claim (the send goes `failed` / `has_gaps`, no SMTP; this never happens through the product, only after a hand edit of the DB). With the flag `reply_drafts` off, approve of a reply → `{ kind: "feature_off" }`, and the committer does not claim reply sends (they wait and expire).
- **Decisions:** D8, D12. New Telegram tap texts for `has_gaps` and `feature_off`; the F102 approve route answers 409 `has_gaps` and 409 `feature_off` (`interfaces.md` § Routes).
- **Test:**
  1. Approve a reply with body `"Tak [[godzina]]"` → `has_gaps`; status stays `awaiting_approval`.
  2. Edit it (F102 `editApproval`) to `"Tak, 10:00"` → the new version approves.
  3. Flag off: approve → `feature_off`; a reply send `approved` before the flag went off is not claimed; a delegation send is claimed.
  4. The Polish tap text for `has_gaps` (unit, fixed value).

## Step 3 — Shared close and replace

- **Goal:** `replaceApproval(trx, ctx, { sendId, payload, userId, via, now })`: the F102 `insertEditedPair` core (locks, version + 1, `supersedes_action_id`, old send `expired` / `superseded`, old draft closed, card edits through `ApprovalHooks.onDecided`), now called by `editApproval` and by stage 13. `closeSend(trx, ctx, { sendId, reason, notify, claimed, now })` (`interfaces.md`, every kind): send `expired` with the reason, draft closed through `closeDraftOfSend`, the cards edited through `ApprovalHooks.onDecided` (`expired`), the delegation hook as `expireSend` does, audit `action.expired` with `reason_code`. `notify: false` sets `result_notified_at` = now; `notify: true` leaves it null (a result notice; texts in stage 09).
- **Decisions:** a refactor of `editApproval` by move, no behaviour change: `actions-edit.test.ts` passes unchanged. `closeSend` also takes a loop-anchored `follow_up` send (F116: `loop_id`, no `email_id`; plan F7), since stage 08 closes any kind; it leaves the committer's `closeSendOfClosedLoop` (`loop_closed`) as it is. `closeSend` with `claimed: false` refuses a send that is not `awaiting_approval` or `approved` without `locked_at` (`{ kind: "busy" }`); `claimed: true` (the committer, holding its claim) also closes its own locked `approved` row, and never an `applying` one.
- **Test:**
  1. `actions-edit.test.ts` unchanged and green.
  2. `replaceApproval` with a new `cc` → new version 2 with the `cc`; the old send `superseded`.
  3. `closeSend` on an `applying` send → `busy` (both `claimed` values); on a locked `approved` row: `claimed: false` → `busy`, `claimed: true` → closed.
  4. `closeSend(reason: "answered", notify: false)` → send `expired` / `answered`, draft closed, one `approval_edit` row per sent card, one audit row, `result_notified_at` set.
  5. `closeSend(reason: "draft_changed")` on an open `follow_up` send → `expired` / `draft_changed`, its draft closed, the loop row unchanged.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the copy hash (stage 08), the result texts of new reasons (stage 09).
