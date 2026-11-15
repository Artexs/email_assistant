# F102 stage 11 review (Opus, FAIL, fixed) and follow-up

Review job `2026-11-15-f102-review-s11-opus-approvals-w-87d7a388`, candidate 4aea6bf8. Result: FAIL, one blocking finding. Fix commit: `F102 s11 review: one closed-state name ...`.

## Blocking (fixed)

- B1: `reject` (`already`) and `edit` (`closed`) answered the raw DB status (`applied`, `applying`, `approved`) while `approve` and the detail route used the `stateOf` names (`sent`, `sending`, `held`). The route now reads the send after the service answer and names it with `stateOf` (`closedStateOf` in `channels/approval-routes.ts`); the edit codes `payload_gone`, `draft_gone`, `delegation_closed` stay. `approvalConflictSchema.state` is a `z.enum` (`approvalClosedStates` + `approvalEditClosedCodes`; a compile-time check ties the list to `approvalDetailStates`). Test: `web-approvals-races.test.ts` "every closed status gets the name of the detail route in all three writes" (sent, sending, approved with a fresh lock, rejected, expired, failed; plus held and superseded cases) and the schema parse of each answer. T6b says `sent`. Mutations: reject returns `result.status` (`/tmp/f102-s11/mut2-reject-raw-status.log`), edit returns `result.state` (`mut2-edit-raw-state.log`), a bad enum name (`mut2-enum-name.log`): each fails.

## Test gaps (closed)

- TG1: no concurrency test. Added three race tests, 8 loops each (`web-approvals-races.test.ts`): two approves (both 200, one `action.approved` row); approve vs reject (reject always 200, send ends `rejected`, at most one approved row, one rejected row); approve vs edit (exactly one 200; the other is 409 `closed` `held` or `changed` with the new id). Mutations, each alone: `lockSend` without `forUpdate` fails all three (`mut2-lock-nolock.log`); `editApproval` with `getSend` fails approve vs edit (`mut2-edit-getsend.log`). The status guard of `setApproved` removed alone survives (`mut2-guard-only.log`): it is a second line behind the row lock and the status switch of `approveRow`, so no input reaches it. Lock and guard removed together fail all three (`mut2-lock-and-guard.log`).
- TG2: the edit-wins branch: with 8 loops both outcomes are allowed by the test; in a run where approve wins the test checks `held` for the edit and no new send; where edit wins it checks `changed` with the new id, the old send `expired`, the new one `awaiting_approval`, no approved row on the old send.

## Notes

- N1: `requireOwner` ran before the flag check, so a member got 403 with the flag off. Fixed: a `flagFirst` middleware runs before `requireOwner` on all three routes (404 for every role). T11 has a member case. Mutations: flag after role on each route fail T11 (`mut2-flag-after-role*.log`).
- N2: a send with `notified_at` null had no 7-day check on approve (the hourly job expires it as `not_notified` up to an hour late). `docs/capabilities/drafts-and-send.md` already says the send ends after 7 days from creation, so `approveRow` now expires it the same way (`not_notified`, answer `expired`); a Telegram tap always has `notified_at`, so only the panel is affected. Tests: older than 7 days expires, younger than 7 days approves; mutation `mut2-seven-day.log`. The 48 h rule for a notified send is unchanged.
- N3: the expiry gap (a panel approve that expires a send queues no card edit) stays accepted in writing (route comment, capability page rule 14). Stage 15 owns the card edit of the expiry paths.
- N4: `already_approved` answers `approved` even for a held send. The page reads `heldBy` from the detail: carry-over in stages 12 and 13 (added).
- N5: nothing to fix (no SMTP or committer call, org scope, id and body validation, audit data, no logs, suspended list).
- N6: races hold: now tests (TG1).
- N7: the 30 worker mutations did not cover concurrency: now covered (TG1).

## Other

- The test setup moved to `web-approvals-kit.ts` (one kit per test file, no shared state); `web-approvals-write.test.ts` and `web-approvals-races.test.ts` use it (files stay below 400 lines).
