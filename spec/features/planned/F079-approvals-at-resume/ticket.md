---
opened: 2026-11-12
---

# F079 · After a pause, an approval request from before the pause cannot go out unseen or late

## Outcome

An organization goes back from `suspended`. An approval request of a draft that the system made before the pause does not reach the owner at a time when the draft is stale, and no send times out without the owner having seen it.

## Scope

- Start at `modules/channels/notices.ts` (the notifier queues `approval` and `approval_set` once and sets `actions.notified_at`), `modules/channels/repo.ts` (`cancelPendingOutboxOfOrg` keeps the kinds `approval` and `approval_set`; the sender ends a row older than 24 h as `failed` / `expired`) and `modules/actions/repo.ts` (the `timeout` rule: 48 h after `notified_at`).
- The gap (S6a plan, A17): an approval request that waits in `outbox` for more than 24 h during a pause is ended by the sender, and the send then times out unseen.
- Decide one of two rules, with a test: (a) at resume, expire the sends whose request was not seen (`awaiting_approval` with a notified time before `resumed_at`), or (b) at resume, queue the cancelled request again with a fresh text.

## Out of scope

- The 48 h rule of an approved send (it exists). Stale `ready` actions (they expire by the 24 h rule).
- The Telegram text of the request.

## Acceptance

- A test with a fixed clock: pause, wait more than 24 h, resume. The owner gets a request, or the send ends with a reason the owner sees. No send ends as `timeout` without a delivered request.
- `docs/architecture.md` §8 "Plan state" names the rule.

## Notes

Follow-up of F077 stage 17 (A17, cold review #7).
