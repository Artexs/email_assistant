> **Status 2026-11-06 — in progress.** The plan is written (20 stages, one file per stage in `s3-assist-actions/`); waiting for the user's approval. Left: approval, then the build from stage 1. The first `assist` run on real mail (stage 20) needs the S1b go/no-go table (`tasks/planned/s1b-shadow-run.md` stage 40).

# S3 Assist actions

Scope: `docs/roadmap.md` §2, row S3. Modules: `docs/modules.md`. Needs: S2 (stages 0–20 built; stages 21–23 open: stage 19 of this plan needs S2 stage 23). The S1b shadow run (`tasks/planned/s1b-shadow-run.md`) limits only stages 19 and 20.

## Goal

In mode `assist` the system changes the mailbox for real (folder moves, mark read, flag, summaries), only for categories that passed the S1b go/no-go table. Every change has Undo.

## Done when

- One week of `assist` mode with at most N = 3 wrong moves, found by Undo or feedback (user decision P2, 2026-11-06).
- The Undo button restores the mail (folder, read state, flag) and writes feedback (test).
- A user move back to INBOX after a system move gives exactly one `imap_move` feedback row; after an Undo it gives none; a second identical copy of a moved mail is stored and triaged as a new mail (tests).
- Every applied action has an audit row.
- A test stops the process between the IMAP call and the DB commit; after restart there is no double action.
- Soft errors do not count toward the 3 tries; after 3 hard errors the action is `failed` and the user gets a notice.
- Backups run (from S1a) and one restore test is logged.

## Plan

> **For the build session:** this plan has the full step detail (Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope). The `run-task` skill skips the `planner` call. The main session wrote the plan on 2026-11-06 without subagents (user rule P7; handoff `~/.pi/agent/notes/2026-11-06-handoff-s3-assist-plan.md`).

### Planning progress

All 20 stage files were written on 2026-11-06 (main session, no subagents). The plan is complete; a build session starts at stage 1.

### Input from S1a (2026-11-03): Interia cannot search by `Message-ID`

- Interia `UID SEARCH HEADER Message-ID <id>` returns no match, also for mail that is in the folder (also with the id without `<>`). `SEARCH HEADER Subject` works. Facts: `notes/2026-11-03-interia-imap-capabilities.md`.
- `ImapMailProvider.findByMessageId` (`apps/server/src/modules/mail/imap/client.ts`) uses that search. At Interia it always returns null, so the sync treats every known mail that comes back to INBOX as "returned", also when it is a second identical copy.
- S1a is not affected (shadow mode moves nothing). This plan replaces `findByMessageId` with `locateMessage` (D3, stage 5).

### Input from S1a (2026-11-04): Interia keeps the UID on a move

- The user moved a stored mail (UID 38829) from INBOX to a new folder and back. It came back with UID 38829. A mail moved into the new folder kept its INBOX UID (38831) there too. RFC 3501 does not allow this, but Interia does it.
- So the S1a sync rule "known mail back in INBOX = a mail above the UID cursor" never fires at Interia: a returned mail is below the cursor. This plan adds the below-cursor check (D4, stage 6).

### Planning input (main session, 2026-11-06)

**Size.** Roadmap says M. Real size: L, 20 stages, 17 `[risky]` (mailbox changes, exactly-once, crash recovery, Undo, feedback, policy gate). Why bigger than M: Interia has no MOVE, no `SEARCH HEADER Message-ID`, and keeps the UID on a move, so the S1a "find moved mail" and "returned mail" rules need a new design (D3, D4).

**Hard parts (most risk first):** 1. find a mail after a move at Interia (stages 1, 5); 2. detect a user move back below the UID cursor (stage 6); 3. crash between the IMAP call and the DB commit (stage 9); 4. Undo (stages 10, 13); 5. the policy gate and the mode switch (stage 14).

**Blockers:** S2 stages 21–23 (stage 19 needs the pilot bot); `tasks/planned/s1b-shadow-run.md` stages 36–40 (stage 20 needs the go/no-go table); `tasks/planned/s1b-claim-index.md` (stage 2 adds the index and closes it).

### User decisions (2026-11-06; the user took the proposed defaults: "Okay, let's use your Proposed values")

- **P1 Test mailbox for real moves:** the pilot mailbox, seed mail only. A new env key `ACTIONS_SCOPE=off|synthetic|all` gates the committer like `TRIAGE_LLM_SCOPE` (D8). The spike and the real-mailbox tests move only `@ea-seed.test` mail.
- **P2 N:** at most 3 wrong moves in the one-week `assist` run (stage 20 says how they are counted).
- **P3 Switches when the mode goes to `assist`:** `flag`, `mark_read` and `move` ON; `move_unsure` OFF; `create_draft` OFF (S4). The CLI `mailbox:settings mode assist` sets them (D13); `mailbox:settings auto` sets `auto` per category from the go/no-go table.
- **P4 Undo button:** a third button ↩️ on each digest line whose mail has an applied move, mark read or flag. No notice per move. Valid while the original action is `applied` and for 7 days after `applied_at`; later the tap answers "Too old to undo".
- **P5 Few or no "go" categories:** start with flag only. The plan builds all actions; what goes live is only config (P3). The user may set `auto` by hand for a category whose precision they accept (`--force`, D13).
- **P6 Backup restore test:** on the Mac with `deploy/restore-test.sh` (stage 17).
- **P7 Planning rule:** the main session writes the whole plan, no subagent calls, progress saved to files after each stage, one approval at the end, then commit and push.

### Design decisions (main session, 2026-11-06; why in each line)

- **D1 Write port.** `MailProvider` gets folder-aware write and read methods: `ensureFolder`, `moveMessage`, `deleteMessage`, `setFlags`, `fetchMetaIn`, `searchSinceIn`, `fetchByUidsIn`. `findByMessageId` is removed (it does not work at Interia). The IMAP adapter moves with `UID MOVE` when the server has MOVE, else `UID COPY` + `\Deleted` + `UID EXPUNGE` (needs UIDPLUS; a plain EXPUNGE is never sent). The fake provider and the GreenMail contract suite cover both paths (an adapter option `forceCopyMove` runs the COPY path on GreenMail, which has MOVE).
- **D2 `emails` columns.** `uid` = the UID in `folder` (as today). New: `inbox_uid` = the last known INBOX UID (set on insert, on `update_uid` and on a return; kept on a system move), `moved_at` = the time of the last system move. The below-cursor check (D4) reads `inbox_uid`; the Undo window and the metric read `moved_at` and `actions.applied_at`.
- **D3 Locate by identity, not by header search.** `locateMessage(provider, folder, key)` (mail module, built on the port): first `fetchMetaIn(folder, hintUid)` and an identity compare; else `searchSinceIn(folder, key.receivedAt − 1 day)` + `fetchByUidsIn` in chunks of 100 + the compare. Identity = normalized `Message-ID` + `content_hash` (the S1a dedup key), pure function `sameMailIdentity` in `sync-rules.ts`. Stage 1 checks at Interia that a COPY keeps RFC822.SIZE, INTERNALDATE and the ENVELOPE date; if the size changes, the compare drops the size (mode `no_size`: `Message-ID` + From + ENVELOPE date), decided in stage 5 from the stage 1 facts.
- **D4 Returned mail below the cursor.** At the end of each incremental sync: rows with `folder <> 'INBOX'` and `moved_at` in the last 7 days (at most 500, oldest first) → `fetchByUidsIn(INBOX, inbox_uids)` in chunks of 100 → an identity match at the row's `inbox_uid` = the user put the mail back → `markEmailReturned` (as in S1a). A fresh copy of a mail always gets a new INBOX UID above the cursor (UIDNEXT), so a hit at the old UID is never a new copy; a new copy goes through the S1a path (`check_folder` → `locateMessage` in the folder → still there → `#2`). On an RFC server a returned mail also comes above the cursor; the S1a path marks it first, and the check then finds `folder = INBOX` and does nothing.
- **D5 Committer = "make it so".** Idempotent actions (`move`, `flag`, `mark_read`, `save_summary`) go `ready → applied` with no `applying` status (architecture §4.1 rule 6). A move is an ensure: locate the mail in the target folder and in the source folder; in both → delete the source copy (a leftover of a COPY before a crash) → applied; only in the target → applied (the IMAP part was done before a crash); only in the source → move → applied; nowhere → `failed` with `status_reason = mail_not_found` at once, no notice (the user moved or deleted it). After the IMAP call, the committer writes `emails.folder`, `uid`, `moved_at`, the action status, `applied_at` and the audit row in one transaction. A crash between the IMAP call and the commit leaves the action `ready`; the next run finds the mail in the target and writes the DB rows without a second IMAP change (done-when test, stage 9).
- **D6 One connection per mailbox per run; order per mail.** The committer runs every 15 s. Per active mailbox: count claimable actions (no connection when there is nothing); claim with `FOR UPDATE SKIP LOCKED` (`locked_at` = the JS `now`, the token for every later conditional update; stale after 10 min); open one IMAP connection only when a mailbox-changing action is claimed; apply in the order `save_summary`, `flag`, `mark_read`, `move` per mail (flags on the known UID first, the move last, because a move can change the UID); close. `save_summary` is DB only and is applied under every scope.
- **D7 Errors on the action row (architecture §4.1 rule 7).** `SoftError` (connection) → release without a count, `next_attempt_at` = now + 5 min, and stop this mailbox for this run. `MailAuthError` → mailbox `auth_error` (the S2 notice), release the batch without a count. `HardError` → `attempts + 1`, `next_attempt_at` = now + 5 min; at 3 → `failed` (`status_reason` = the error code) and the owners get a notice (D11). `mail_not_found` → `failed` at once, no notice, no count. A stale claim (`locked_at` older than 10 min) is taken back without a count (idempotent actions).
- **D8 `ACTIONS_SCOPE` (P1).** `off` (default) = the committer applies no mailbox change (only `save_summary`); `synthetic` = mailbox changes only for mail with a synthetic `Message-ID` (`@ea-seed.test>`), in every mailbox; `all` = also real mail, only of the mailbox `TEST_MAILBOX_ADDRESS`. The server refuses `all` without `TEST_MAILBOX_ADDRESS`. Actions that the scope holds back stay `ready` and are not claimed (the digest says "will move"; `/status` shows the scope). `synthetic` is not a security boundary (any sender can write such an id); it is a test gate for the build and the VPS seed run.
- **D9 Folders.** `ensureFolder(name)` (adapter): LIST; when missing, `mailboxCreate(name.split("/"))` (imapflow joins the parts with the server's delimiter) and LIST again; it returns the path as the server lists it. The committer calls it once per target per run (cached) and, when the real path differs from `folder_map[key]`, writes the real path into `mailboxes.folder_map` (audit `mailbox.folder_created`). `emails.folder` always holds the real path. Stage 1 prints the Interia delimiter.
- **D10 Undo = reverse actions per mail.** `actions.undo(db, ctx, emailId, user)`: in one transaction, lock the mail's actions; for every original action (`reverses_action_id IS NULL`) of type `move`, `flag` or `mark_read` with status `applied`, `applied_at` within 7 days and no reverse row yet: insert a reverse row (same `type`, `payload` = the original payload, `reverses_action_id` = the original id, `idempotency_key` = `${originalId}:undo`, status `ready`), audit `action.undo_requested`. The committer applies a reverse row as the inverse operation: move → ensure the mail in INBOX; flag → remove `\Flagged`; mark_read → remove `\Seen`; then sets the original to `undone` in the same transaction (architecture §4.4). The caller (the Telegram callback) writes the feedback row (`wrong`, source `undo`) when at least one reverse row was created and the latest category is not `unsure`.
- **D11 Notice `action_failed`.** A new outbox kind. One notice per failed action (dedup `action_failed:<actionId>`) to the linked owners, text: the action verb, the cleaned subject, "tried 3 times", what the mail state is (stays in INBOX, or for a failed Undo: stays in `AI/…`, move it by hand). The detector sets `actions.notified_at` in the same transaction as the outbox insert, so a second run makes no second row. `mail_not_found` gives no notice (D5).
- **D12 User move back → feedback (architecture §4.4).** A new job `triage.returned` (every 15 s, always on, no LLM): for each row with `returned_at` set: read the mail's last original `move` action; when it is `applied` and has no reverse row in `ready`, `applying` or `applied` → set it `undone` (`status_reason = user_moved_back`), write one feedback row (`wrong`, source `imap_move`; none when the latest category is `unsure`, because `recordFeedback` refuses a verdict without a category there), audit `email.returned`; in every case clear `returned_at`; one transaction. A mail returned after an Undo has its move `undone` already → no feedback row (done-when).
- **D13 CLI `mailbox:settings`.** Subcommands: `show`; `mode shadow|assist` (on `assist` it sets the P3 switches unless `--keep-switches`); `auto <category> on|off [--threshold 0.nn] [--force]` (`on` runs the real-mail eval report of the mailbox: precision ≥ 98% with ≥ 30 kept rows, else it refuses unless `--force`; refuses `unsure` and `delegation`); `switch <name> on|off`. Each change writes an audit row (`mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed`, with `forced` in the data). A mode change acts on new triage only: `logged` rows of the shadow time are never applied later.
- **D14 Undo button in the digest (P4).** `ActionView` gets `id`, `reverse`, `reversesActionId`, `appliedAt`; `describeActions` skips reverse rows (the original shows `undone:`); a pure `isUndoable(actions, now)` says whether the line gets `↩️ n` (`fu:<emailId>`, callback kind `undo`). The tap answers with a toast only (the digest text is not edited): "↩️ Undo started: the mail goes back within a minute.", "Undo was already requested for this mail.", "Nothing to undo.", "Too old to undo (7 days).", or "This mail is not in your account." (the same text as the feedback buttons: no leak). The urgent notice gets no Undo button (a flag is harmless; the digest line of the mail has it).
- **D15 Audit events (new):** `action.applied`, `action.failed`, `action.expired`, `action.undo_requested`, `action.undone`, `email.returned`, `mailbox.folder_created`, `mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed`. Data: ids, types, folder keys, attempts, codes, booleans. No mail text.
- **D16 Module borders.** `actions` owns the committer, the undo service and the claim queries; it imports `mail` (port, `locateMessage`, `updateEmailLocation`) and `audit`. `triage` owns the returned job (`triage → actions` exists). `channels → actions` for the Undo tap (modules §2). `mail` never imports `actions` or `triage`. `reports → actions` and `actions → mail` exist. No new edge: the committer reads no settings (the policy already decided at triage time), and the settings CLI composes `triage` (the eval report) and `config` (the setter) in the script, so `config` never imports `triage`.
- **D17 Logs.** Ids, counts, types, folder keys, codes and times only. Never a subject, an address, a folder path that the user typed, or an error message (`describeError` only). The stage 15 log test proves it.
- **D18 The `mailbox:audit` tool is unchanged.** `listInboxEmailKeys` reads only rows with `folder = 'INBOX'`, so mail that the system moved is not counted; a user move out of INBOX still shows as a "duplicate" (S1a check, 2026-11-06). Stage 18 writes this meaning into the runbook.
- **D19 Migration `YYYYMMDD000001_assist_actions.sql` (stage 2).** `actions.applied_at`; `emails.inbox_uid`, `emails.moved_at`; indexes `emails_claim_idx (mailbox_id, status, received_at)` (closes `tasks/planned/s1b-claim-index.md`), `emails_moved_idx (mailbox_id, moved_at) WHERE folder <> 'INBOX'`, `emails_returned_idx (mailbox_id) WHERE returned_at IS NOT NULL`, `actions_email_type_idx (email_id, type)`, a partial unique index on `actions (reverses_action_id) WHERE reverses_action_id IS NOT NULL`; the `outbox.kind` check gets `action_failed`.
- **D20 Tests with two connections** (the crash test, the claim test) use their own organization and delete it at the end; the dev DB can hold other active mailboxes, so job tests call `pauseOtherMailboxes(trx)` first (S1b rule).
- **D21 Stale `ready` originals expire.** The committer claims an original mailbox-changing action (`move`, `flag`, `mark_read`, `reverses_action_id IS NULL`) only within 24 h of its `created_at`. At the start of each mailbox run it sets older `ready` originals to `expired` (`status_reason = stale`, audit `action.expired`) in one batch update. Why: a mode or scope change, or a long outage, must not move mail from days ago that the user has handled by hand (stage 19 runs `assist` with scope `synthetic` for days while real mail gets `ready` rows). Reverse rows and `save_summary` never expire. `describeActions` shows an `expired` row as nothing (the line says "stays in INBOX").

### Facts checked on 2026-11-06 (sources)

- imapflow 1.7.8 (`node_modules/imapflow/lib/imap-flow.d.ts`): `messageMove` / `messageCopy(range, destination, { uid })` return `CopyResponseObject | false` with `uidMap?: Map<number, number>` (only with UIDPLUS); `messageFlagsAdd` / `messageFlagsRemove(range, flags, { uid })` return boolean; `messageDelete(range, { uid })` sends `UID EXPUNGE` with UIDPLUS, else a plain EXPUNGE (`notes/2026-11-03-greenmail-facts.md`); `append` returns `uid` with UIDPLUS; `mailboxCreate(path: string | string[])`; `list()` entries carry `delimiter`.
- Code: `actions` has no `mailbox_id` column (the claim joins `emails`); `actions.idempotency_key` is unique per org, `createPlanned` uses `${emailId}:${type}`; `triage_feedback.source` already allows `undo` and `imap_move`; `emails.returned_at` and `markEmailReturned` exist; `decidePolicy` encodes the §4.3 table with `categoryAuto` = `autoFor(policy, category)` and `movesSupported` = MOVE or UIDPLUS; `listInboxEmailKeys` filters `folder = 'INBOX'`; `main.ts` stubs `isOwnActionId` to `false` (S4 wires it: S3 creates no mail with the header).
- S2 code: `outbox.kind` is a CHECK constraint; `insertOutbox` dedups on `(org_id, user_id, dedup_key)`; `handleCallback` gives the same answer for an unknown id and another organization's id; the digest keyboard has 2 lines per button row.
- Interia (`notes/2026-11-03-interia-imap-capabilities.md`): IDLE and UIDPLUS yes; MOVE, CONDSTORE, SPECIAL-USE, keywords no; no `SEARCH HEADER` for `Message-ID`; the UID is kept on a move; folders `Wysłane`, `Wersje robocze`, `Wiadomości-śmieci`, `Kosz` plus user folders.
- `deploy/restore-test.sh` exists and runs on the Mac with the `age` key at `~/.config/ea-backup/age-key.txt` (`notes/2026-11-03-pilot-vps.md`).

### Not verified (stage 1 checks the Interia items; stage 16 the Telegram item)

- At Interia: the hierarchy delimiter; whether `COPYUID` comes back and whether its UID equals the source UID; whether a COPY keeps RFC822.SIZE, INTERNALDATE and the ENVELOPE date; whether `SEARCH SINCE` works in a folder other than INBOX; whether `UID EXPUNGE` removes only the given UID; the UID of a mail copied back to INBOX; whether `\Flagged` is kept.
- Telegram: the limit of inline buttons per message and per row (the digest uses at most 15 × 3 = 45 buttons, 6 per row).
- Postgres: the generated name of the `outbox.kind` check constraint (`outbox_kind_check` by the default rule; stage 2 reads it from `pg_constraint` first).

### Rules for every step (read before each step)

- Code rules: `docs/code-patterns.md`. `packages/core` has no I/O and no `process.env`. Other modules import a module only through its `index.ts`. Every repository function takes a `TenantContext` and filters by `org_id`, except the scheduler entry points (`listSyncTargets`, `claimDueOutbox`, `listLinkedChats`, and the S3 ones named in a stage). Template literals, no `+` for strings. `createLog("<module>")`, never `console.log`. A status change and its `audit_log` row go in one transaction. Conditional updates (`WHERE status = … AND locked_at = …`) guard every status change.
- **Only the committer changes a mailbox.** No other code path (CLI, test tool, job) may move, flag or delete real mail. The exceptions are the test tools that refuse every address except `TEST_MAILBOX_ADDRESS` (`mailbox:seed`, the stage 1 `mailbox:probe-move`).
- **No mail body, subject, address, summary, folder path from mail data or secret in a log line or an error message.** Log ids, counts, types, folder keys, codes and times only. For an error use `describeError(error)`; for a Telegram error `telegramErrorLabel(error)`.
- **Scope gates:** `ACTIONS_SCOPE` keeps its default `off`; no step changes `.env`. Only stage 16 sets `synthetic` on the command line on the Mac; only stages 19 and 20 set it on the VPS (the user edits the VPS `.env`). `TRIAGE_LLM_SCOPE` is S1b's: S3 does not change it.
- **Do not touch the VPS** (`ssh home_vm`, its cron, its `.env`) before stage 19 and the user's go. Never print or edit any `.env`.
- Do not commit (the main session commits each stage after the review). Never run `bun run format` or `prettier --write` outside the step's files (S2 incident).
- Checks after each step (the step names which ones):
  - `bun run lint && bun run typecheck && bun run test:unit`
  - with DB: `bun run dev:up && bun run db:migrate && bun run test:int` (dev `db` on port 5433, GreenMail; `.env` has `MIGRATOR_DATABASE_URL`).
  - Markdown files: `bunx prettier --check <files>` (`bun run lint` is ESLint only).
- Integration tests: `withRollback` from `apps/server/test/integration/helpers.ts`; fixtures from `fixtures.ts` (`createOrgWithMailbox`, `insertTestEmail`, `insertTriaged`, `pauseOtherMailboxes`, `addMember`, `linkChat`, `isolateChannels`); S3 adds `insertAction` and `insertTriagedWithActions` (stage 7). A test that needs `mailbox_settings` calls `insertDefaultSettings`. A statement that must fail runs inside `trx.savepoint`. Code that runs in a transaction it may get from a caller uses the S1a pattern `db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)`.
- Fake mail in tests: `createFakeMailProvider` (`mail/fake`); a test of the COPY path uses `capabilities: { move: false, uidplus: true }`. No test and no job touches a real mail server except the GreenMail contract tests and the stages that say so.
- Times in tests: fixed `Date` values; never `new Date()` in an assertion.

### User checkpoints

The main session stops after the commit of the named stage and gives the user a short summary: what was built, the check commands and their output, open issues. The next stage starts only after the user says go.

1. After stage 1 — the Interia facts from the spike. They settle the "Not verified" items; the main session writes the outcomes into the stage 4, 5 and 9 decisions before the build goes on.
2. After stage 7 — migration, port, locate, returned check and repositories (schema errors are the most expensive to fix later). Group review of stages 2–7.
3. After stage 15 — all code is built and wired. Group review of stages 8–15. Then stage 16 is the user's own run on the Mac.
4. Before stage 19 — VPS deploy: needs S2 stage 23 done (the pilot bot) and the user's go; a deploy in the S1b shadow week restarts the server (stage 19 names the risk). Before stage 20: the S1b go/no-go table exists (stage 40 done) and the user chooses the `auto` categories.

### Review model

Implementers run on default Sonnet. Stage reviews of `[risky]` stages run on Opus, high (user, planning input 2026-11-06); the other stages on Sonnet, high. The group reviews at checkpoints 2 and 3 run on Opus, high.

### Stages

Each stage lives in its own file in [`s3-assist-actions/`](s3-assist-actions/). An implementer or reviewer reads this file (Input, Rules, checkpoints) and only the stage file of its step. The main session ticks the step boxes in the stage file and the stage box here.

- [ ] [Stage 1](s3-assist-actions/stage-01-interia-move-spike.md) — Interia move spike: `mailbox:probe-move` on the real mailbox [risky] — user checkpoint 1 after it
- [ ] [Stage 2](s3-assist-actions/stage-02-s3-migration.md) — S3 migration: `applied_at`, `inbox_uid`, `moved_at`, indexes, outbox kind [risky]
- [ ] [Stage 3](s3-assist-actions/stage-03-mail-write-port-and-fake.md) — Mail write port, fake provider, contract cases [risky]
- [ ] [Stage 4](s3-assist-actions/stage-04-imap-adapter-writes.md) — IMAP adapter writes (MOVE and COPY paths) on GreenMail [risky]
- [ ] [Stage 5](s3-assist-actions/stage-05-locate-message-and-sync.md) — `locateMessage`, identity rules, sync without `findByMessageId` [risky]
- [ ] [Stage 6](s3-assist-actions/stage-06-returned-below-cursor.md) — Returned mail below the UID cursor [risky]
- [ ] [Stage 7](s3-assist-actions/stage-07-actions-repo-and-fixtures.md) — Actions repository: claim, finish, release, fail; email location; fixtures [risky] — user checkpoint 2 after it
- [ ] [Stage 8](s3-assist-actions/stage-08-committer-flags-summary-errors-job.md) — Committer: flags, summaries, error rules, scope, the job [risky]
- [ ] [Stage 9](s3-assist-actions/stage-09-committer-move-and-crash-test.md) — Committer: move as an ensure, folders, the crash test [risky]
- [ ] [Stage 10](s3-assist-actions/stage-10-undo-service-and-reverse-actions.md) — Undo service and reverse actions [risky]
- [ ] [Stage 11](s3-assist-actions/stage-11-returned-feedback-job.md) — `triage.returned`: a user move back becomes feedback [risky]
- [ ] [Stage 12](s3-assist-actions/stage-12-action-failed-notice.md) — Notice `action_failed` [risky]
- [ ] [Stage 13](s3-assist-actions/stage-13-digest-undo-button-and-status.md) — Digest ↩️ button, the Undo tap, `/status` lines [risky]
- [ ] [Stage 14](s3-assist-actions/stage-14-mailbox-settings-cli.md) — CLI `mailbox:settings`: mode, auto (go/no-go check), switches [risky]
- [ ] [Stage 15](s3-assist-actions/stage-15-server-wiring-and-log-test.md) — Server wiring, `ACTIONS_SCOPE`, shutdown, the log test [risky] — user checkpoint 3 after it
- [ ] [Stage 16](s3-assist-actions/stage-16-dev-run-assist-on-greenmail.md) — Dev run: `assist` on GreenMail with the dev bot [risky]
- [ ] [Stage 17](s3-assist-actions/stage-17-backup-restore-test.md) — Backup restore test on the Mac
- [ ] [Stage 18](s3-assist-actions/stage-18-docs-notes-follow-ups.md) — Docs, notes, known alerts, follow-ups
- [ ] [Stage 19](s3-assist-actions/stage-19-vps-deploy-and-seed-mail-assist.md) — VPS deploy, `assist` on seed mail, real-mailbox checks [risky] — user checkpoint 4 before it
- [ ] [Stage 20](s3-assist-actions/stage-20-one-week-assist-run.md) — One week of `assist` on real mail, results [risky]

### Results (filled in stages 1, 16, 17, 19 and 20)

_Not yet._

## Questions for the user

Answered 2026-11-06 with the plan defaults (P1–P7). Open for the approval of this plan (each keeps the plan default without an answer):

1. **D14:** the urgent notice gets no Undo button (the digest line of the mail has it). Keep?
2. **D7:** a `mail_not_found` action fails at once without a notice (the user moved or deleted the mail). Keep, or notify?
3. **D13:** `mailbox:settings auto <category> on` refuses below the 98% / 30-rows bar unless `--force`. Keep the hard refusal?
4. **D4:** the below-cursor check looks back 7 days (the same window as Undo). Keep 7 days?

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap, code patterns); ADR 0003 and ADR 0010 stay accepted (implementation notes added).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
- 2026-11-06: Planning input added (size, hard parts, blockers, user decisions). Handoff for the planning session: `~/.pi/agent/notes/2026-11-06-handoff-s3-assist-plan.md`.
- 2026-11-06: Moved to `active/`. The user took the proposed defaults P1–P7. Checked the handoff "Current state" against the code: no difference (notes: `main.ts` stubs `isOwnActionId`; `mail/imap/probe.ts` has write helpers). Plan written: 20 stages, one file per stage in `s3-assist-actions/`; 17 stages `[risky]`. Design decisions D1–D20 and 4 questions for the user.
