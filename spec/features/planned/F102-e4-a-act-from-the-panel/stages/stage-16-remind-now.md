# F102 stage 16 — Remind now [risky]

Part of [`../plan.md`](../plan.md). Read D9, Q4, Q6 and [`../commands.md`](../commands.md). Needs stage 15 landed.

`[risky]`: it plans a mail to a person (the send still needs a tap: ADR 0003) and it must not double a reminder. One step in module `delegation`.

## Step 1 — `remindNow` and its route [risky]

- **Goal:** an owner asks for a reminder to the delegate now, without waiting for the chaser.
- **Files:** `delegation/chaser.ts` (split out the planning of one reminder so the chaser and `remindNow` share it), `delegation/service.ts` or a new file for `remindNow`, the router of stage 15, the audit event list, tests.
- **Interfaces:**
  - `remindNow(deps, ctx, delegationId, { userId, via: "web" | "cli", now })` → `{ kind: "planned"; sendId } | { kind: "not_open" | "limit_reached" | "reminder_waiting" | "drafts_off" | "delegate_inactive" | "not_found" }`.
  - `POST /api/delegations/:id/remind` with `apiDoc` (`remindDelegation`), owner only, flag `delegation_pages`. Answers: `planned` → 200 `{ status: "planned", sendId }`; `not_found` → 404; every other kind → 409 with its code.
  - Audit event `delegation.remind_requested`, data `{ delegation_id, reminder, via }`.
- **Decisions:**
  - One transaction, the chaser's order: share-lock the mailbox settings row first (the settings version rule), then lock the delegation, then count its pending reminder sends.
  - Checks, in this order: the delegation is `sent` or `overdue` (else `not_open`); `reminders_sent` < 2 (else `limit_reached`); no reminder send of it is `awaiting_approval`, `approved` or `applying` (else `reminder_waiting`: this check under the lock is the dedup of a double click); the delegate is active (else `delegate_inactive`); the mailbox is in `assist` mode with the switch `create_draft` on (else `drafts_off`, Q6).
  - No due-date gate, no 3-day gap, no 07:30 gate: the owner asked now. The chaser's own rules do not change.
  - The reminder is the same as the chaser's: a `reminder` draft (fixed template, thread of the delegation mail, the delegate as the only recipient, number = `reminders_sent` + 1) and its send `awaiting_approval`, with no `set_id` (one card, `approval` kind). It needs a tap like every send.
  - Idempotency keys: the chaser's key holds the local day, so a second reminder on one day would clash. `remindNow` uses `<email id>:create_draft:reminder:manual:<new draft id>` and `<email id>:send:reminder:manual:<new draft id>`; the dedup is the lock check above, not the key.
  - The delegation status does not change (`overdue` stays `overdue`); `last_reminder_at` and `reminders_sent` change when the send is applied, as today.
- **Test** (integration; O1, mailbox in `assist` with `create_draft` on, delegate Anna active, U1 owner, now `2026-11-20T13:05:00Z`):
  - T1: D3 `overdue`, `reminders_sent` 0, no pending reminder → `planned`; one `reminder` draft `ready` with `reminder` 1 and one send `awaiting_approval` without `set_id`; one audit row with `via` `web`.
  - T2: the same call again → `reminder_waiting`; no new row.
  - T3: two calls at once on D3 (no pending reminder) → one `planned`, one `reminder_waiting`.
  - T4: D2 `sent`, due tomorrow → `planned` (no due gate).
  - T5: `reminders_sent` 2 → `limit_reached`; `drafted`, `answered`, `done`, `cancelled` → `not_open`.
  - T6: mode `shadow` → `drafts_off`; `assist` with `create_draft` off → `drafts_off`; delegate disabled → `delegate_inactive`.
  - T7: after T1, a chaser run with `force` plans no second reminder for D3.
  - T8: after T1's reminder was rejected the same day, a second `remindNow` → `planned` (no key clash).
  - T9: the send of T1 is never `approved` without a tap: after one committer tick it is still `awaiting_approval`, and the notifier queues one `approval` card once its draft is `applied`.
  - T10: the route: a member → 403 `owner_only`; flag off → 404; an id of O2 → 404; T1 by HTTP → 200 `{ status: "planned", sendId }`.
- **Done when:** T1–T10 pass; the existing chaser tests pass unchanged.
- **Out of scope:** "remind all" (Q4); reminders in shadow mode.

## Done when (stage)

- Step 1 holds. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s16`).
