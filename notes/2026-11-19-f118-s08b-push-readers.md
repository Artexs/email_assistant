# F118 stage 08b — push rows in the outbox readers and the Telegram fallback: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 08b). No migration. No new Polish text. `TERMS_VERSION` NOT bumped (stage 13 does it).
Gate: checkpoint A has NOT run. `web_push` stays OFF by default. Nothing is deployed. No real push was sent (a fake push service in every test).

## First commit (carry-over of the stage 08 review)
- Tests of the surviving mutants: m12 (`Retry-After` 120 wins over the 30 s backoff, `push-sender.test.ts` 4b), m07b (an `approval` row goes with `Urgency: high`, 1c), m35 (a row posted and then hit a database error stays `sending` until the stale reclaim after 5 min, 19: the db is a proxy whose transaction fails after the POST), m16 (a second run of the same sender inside the 10 min key-version pause claims nothing, not even a new row, 20). Also 4c (five 429s end `too_many_errors`).
- TTL of a push message = `max(0, 86400 − row age in seconds)` (test 1 and 18). Rule 3c of `docs/capabilities/digest-and-notices.md` says it, and that a 429 counts an attempt.
- `POST /me/push/test` answers `500 internal` on a key-version mismatch and keeps the device (`web-push.test.ts`); line in `docs/capabilities/web-panel.md`.
- `deploy/compose.drill.yaml` sets `VAPID_PRIVATE_KEY: ""` (pinned in `deploy/test/compose-drill.test.ts`); known alert `push_key_version_mismatch` has status "open until the key is restored".

## What was built
- `platform/db/outbox-keys.ts`: `PUSH_KEY_INFIX`, `pushDedupKey` (moved here, re-exported by `channels/push`), `dedupKeyOrPush(column, key)` = `column = key or starts_with(column, key || ':push:')`. `starts_with`, not LIKE: no wildcard of a key matters.
- Readers that now match push rows (D22): `failPendingCardsOfSend` (and `listClosedFollowUpCards`, its caller's list), `requestSent` and `listUnseenApprovalSends` (`actions/repo/approvals.ts`), `listSentStaleEpisodes` (the `sync_ok` match, and one entry per member and episode: with devices a stale notice has one push row per device), `cancelPendingOutbox` with `exceptDedupKey`, `noAwaitingApprovalSend` (resume hook and erase).
- Fallback (D23): `channels/push/fallback.ts` `queueTelegramFallback` (loop_id guard, chat link check, key without `:push:<id>`, `insertOutbox` keeps one row per event). Called by `removeDevice` for every open row it ends (so a 410, a session that ended, the member's own Remove and the 11th-device cap all fall back) and by the sender's `endNoDevice` for a row with no device id or no device row.

## Decisions to confirm (not named in the stage file, each follows from D22/D23)
1. `cancelPendingOutbox` `exceptDedupKey`: the stage 07 fan-out writes `<key>:push:<id>` rows, and the detectors then cancel pending rows of that kind and mailbox whose key differs from `<key>`. Without the change a fresh `sync_stale`, `auth_error`, `host_blocked` or `sent_missing` push row was cancelled (`outdated`) in the same run. Fixed (test 6 of `push-readers.test.ts`).
2. `noAwaitingApprovalSend`: without the change the resume hook of a suspended organization ended the push row of a send that still waits. Fixed (test 7).
3. `listClosedFollowUpCards`: lists a closed follow-up whose only card is a pending push row, so `queueCardEdits(expired)` fails it. Fixed (test 1c).
4. The fallback runs inside `removeDevice` (all callers), not only in the sender. D23 says "removed" too.
5. The fallback Telegram row keeps the push row's `created_at` and is due at once (`next_attempt_at` = `created_at`): the 24 h life runs from the event.

## Other readers (all grepped: `dedup_key`, `channel = 'telegram'`, outbox selects)
Push counts: `lastRepliesReady` (kind only, any channel), `cancelPendingOutbox` with `dedupPrefix` (`starts_with` already matched push keys), `clearLoopCards` waiting/blanked rows (by `loop_id`, any channel), retention and erase blank/drop by kind and status (any channel), `countFailedOutboxSince*` (`no_device` excluded since stage 07), `lastOutboxSentAt` (any channel).
Telegram only (reason): `listCardsOfSend`, `getEditTarget`, `newerEditSent`, `findApprovalCardOfTap`, `listDeliveredCardsOfExpiredFollowUps` (need a Telegram message id; card edits are Telegram), `findReviewCards`, `hasReviewCardSince`, `findReplyPrompts`, `findReplyTargetOfMessage` (review cards and reply questions are written with `only: "telegram"`; they key on `:r<n>` or a message id), `findOutboxByDedup` (taps; the weekly report: no push group), digest and report readers and `digest-job` (`channel = 'telegram'`, kinds with no push group), `brief-line-edit` (digest message id), `own-report-mail` (mail rows), `repo/links` (chat links), M5 metric and urgent SLO (Q11), the Telegram sender claim (`channel` default).

## Proof logs
Under `.f118s08b-logs/` in the job worktree (untracked): `mutation-c-*.log` (carry-over guards: m12, m07b, m35, m16, TTL, TTL floor, route 500, drill key) and `mutation-s1-*.log`, `mutation-s2-*.log` (stage guards: card fail, request seen, unseen list, episode match and grouping, LIKE instead of `starts_with`, except key, resume hook, closed follow-up list, chat check, loop guard, twin check, refused falls back, `endNoDevice` fallback, `removeDevice` fallback). Every mutation made at least one test fail; each was restored. `proof-*.log` and `proof-result.txt` hold the final chain.
