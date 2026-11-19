# F110 stage 05 review (Opus 5.5, FAIL 55b3bfd4)

Model: Opus 5.5, because the stage is [risky] (mail access, OAuth opener, sync and dedup, stored mail data).

BLOCKING (repair):
- B1 (proven by a repro test): the `history` purpose stores live new mail above the cursor as `skipped`/`history_check` (`backfillInbox` uses `fetchSince`, which keeps every UID, also UIDs above `folder.last_uid`). The next regular sync finds that row in INBOX, gives `update_uid` and never inserts it: the mail is never triaged, no urgent notice, no digest line. It happens when a mail arrives between the last sync tick and the history run, and stage 06 runs history right after connect. Fix: for `history`, keep only mails with `uid <= folder.last_uid` (`const kept = history ? fetched.filter((m) => m.uid <= folder.last_uid) : fetched`); the reviewer's repro (`syncedMailbox`, deliver h9 above the cursor, history run, then `syncMailbox`: expect `pending`) becomes a test; adapt the test "a mail with the X-EA-Action-Id of an own draft is not stored as history mail" (its draft sits above the cursor); add the shared-server race order (both runs read the same fake server) to the race test.

TEST GAPS: TG1 (the insert-only filter: `returned` and `relocated` writes must be dropped: a system-moved row that the user moved back into INBOX inside the window: the history run leaves `returned_at` null and `folder` and `uid` unchanged; mutation `planned.filter(w => w.kind !== "update_uid")` must fail); TG2 (stage 07 keeps history mail out of `triage_results`; a test that no `triage_results` row appears for a history mail).

Merge: master now holds stage 04 (`e3923028`). Merge master into the branch: conflicts only in `web.ts` (take master's `import { goNoGoFor, triageRoutes }` and keep the `./modules/trust` import) and `docs/diagrams/module-graph.{json,md}` (rerun `bun run graph:modules`); the `trust_ladder` lines in `features.ts`, `lab/seed.ts` and two tests merge clean (check there is no duplicate key).

Accepted: `requeueTooOld` also requeues `history_check` for the operator `mailbox:backfill` (explicit operator window; same spend and privacy as the backfill before F110). OAuth path, connect hook, CLI, DSR erase plus history, readers of `skipped`: all checked and right.

Carry-over:
- N3 (Q8, privacy): retention counts from `created_at`, so a history mail received 29 days before connect keeps body and headers until day ~59 of its age; onboarding text must not suggest a 30-day age limit. History bodies reach the LLM as thread context (`listThreadContext` takes 500 characters from any `emails` row with no status filter).
- N4 (stage 25): `account-data.md` line 83 and `sync.md` rule 19 ("run the erase again after a backfill") must name the automatic history check at connect, which stores mail that has no tombstone.
- N5 (stage 06): `historyRefusalBeforeOpen` does not check the mailbox status: a paused, `auth_error` or `host_blocked` mailbox is still opened. Decide: a user pause should stop the history read.
