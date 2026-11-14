# F100 plan review 1

Cold review job `2026-11-14-f100-plan-review-f3f44645` (Opus 5.5, high, `--review` on branch `limen/2026-11-14-f100-plan-e3a-36bfeede`, candidate `dfd0e00`). Its final message, filed whole (output of `limen jobs <id>`, 2026-11-14). Fixes: `plan.md` § Cold review.

```text
DONE WITH OPEN CHECKS plan review · F100 · id 2026-11-14-f100-plan-review-f3f44645 · branch limen/2026-11-14-f100-plan-e3a-36bfeede · elapsed 14m · silent 0s · tools 110 · finish
  diff:
  spec/features/planned/F100-e3a-measure/plan.md     | 251 +++++++++++++++++++++
   .../features/planned/F100-e3a-measure/questions.md |  17 ++
   .../stages/stage-01-capture-parser.md              | 110 +++++++++
   .../stages/stage-02-port-and-adapters.md           |  72 ++++++
   .../stages/stage-03-signals-probe.md               |  64 ++++++
   .../F100-e3a-measure/stages/stage-04-migration.md  | 134 +++++++++++
   .../stages/stage-05-store-capture.md               | 111 +++++++++
   .../stages/stage-06-flag-refresh.md                | 114 ++++++++++
   .../stages/stage-07-sync-interval-and-pause.md     | 123 ++++++++++
   .../stages/stage-08-core-metrics-1.md              | 183 +++++++++++++++
   .../stages/stage-09-core-metrics-2.md              | 202 +++++++++++++++++
   .../stages/stage-10-row-readers.md                 | 111 +++++++++
   .../stages/stage-11-week-service.md                |  94 ++++++++
   .../stages/stage-12-mistake-capture.md             | 141 ++++++++++++
   .../stages/stage-13-answered-check.md              | 111 +++++++++
   .../stages/stage-14-weekly-report.md               | 159 +++++++++++++
   .../F100-e3a-measure/stages/stage-15-stats-page.md |  84 +++++++
   .../F100-e3a-measure/stages/stage-16-docs.md       |  57 +++++
   spec/features/planned/F100-e3a-measure/ticket.md   |  35 ++-
   19 files changed, 2163 insertions(+), 10 deletions(-)
  log:
  - **Drift from decisions (N8–N11).**
    - PD-068 requires a flag for the new pause line; the plan ships it without one.
    - PD-066 asks for M8 holdout evidence and precision only from 30 labels; the plan leaves out the holdout and prints precision at any count.
    - PD-127 counts "surfaced" by the due day; the plan uses one working day later.
    - E5 expects numbers from the first weekly report that E3a does not produce.
  - **Plausible risks:**
    - N2: a capture error drops the mail body text too.
    - N3: rows 7–30 days old after a UIDVALIDITY change get the flags of other mail.
    - N14: M8 shows today's values in all 8 week columns.
    - N15: more than 10 mailboxes breaks the `max(50)` schema.
    - N17: `/status` can show "paused" for up to 2 h after one soft error.
  - **Stage size (N20).** Stages 10, 12 and 14 are too big for one job.
  - **Board drift (N23).** `spec/build.md:38` still says "needs plan". I did not change it.
  
  I ran `bun install`, mailparser and node probes, and a throwaway Postgres in `/tmp/f100-review`. I ran no lint, typecheck or test suites, because the change is plan text only.
  
  The probe output was not saved to a log, so the note check marks the "blocking only when proven" rule as not proven.
  
  Full review: `/tmp/f100-review/review.md`
  [limen 2026-11-14T06:38:33.807Z] done: pi exited 0
  spawned-by job 2026-11-14-f100-plan-e3a-continue-9610d135
  candidate dfd0e00ab587385f794e7ffe3c994f7df016dac2
  model claude-bridge/claude-opus-5-5
  tokens 105 turns · input 210 · output 84,750 · cache read 18,276,472 · cache write 271,841
  open-checks:
    Easy-to-miss rule (blocking only for a proven break of an acceptance bullet; plausible never blocks): not proven. B1 is the only blocking finding, and it names acceptance 3. The node, mailparser and Postgres probe outputs were seen in this…
  versions:
    pi 1.5.2
    herdr herdr 0.9.5
    hunk 0.25.0
  result:
    FAIL dfd0e00ab587385f794e7ffe3c994f7df016dac2
    
    The plan fails review on one blocking finding. One mail with a crafted header or attachment name can stop a mailbox from syncing permanently, and that breaks the ticket acceptance for stored headers. All the expected numbers I recomputed for stages 08–11 and 14 are correct. There are 23 non-blocking findings.
    
    HEAD matches the candidate, and the tree is clean. The change touches only `spec/features/planned/F100-e3a-measure/`: 19 files, plan text, no code.
    
    ## Blocking
    
    **B1 (proven).** A header capture can fail the database check and roll back the sync transaction. The sync then repeats the same failure on every run, so the mailbox never syncs again. This breaks ticket acceptance 3 (`ticket.md:30`: "A new mail gets one `email_headers` row in the transaction that stores it"). It also stops all later mail of that mailbox.
    
    - **Plan text.**
      - `stage-01-capture-parser.md:80` cuts strings with `slice(0, limit)`, which counts UTF-16 units. A cut can split an emoji and leave a lone surrogate.
      - `stage-05-store-capture.md:43` writes `attachments` and `links` as `JSON.stringify(...)` cast to `jsonb`.
      - `CAPTURE_LIMITS` (`stage-01:17-30`) has no limit for `returnPath`, but the migration has `CHECK (char_length(return_path) <= 320)` (`stage-04:25`).
      - `stage-05:69` runs `insertEmailHeaders` inside the `applyChunk` transaction with no savepoint. D4 (`plan.md:43`) covers only a parse failure ("the sync goes on"), not a database error.
    - **Proof** (probes in `/tmp/f100-review`, run against a throwaway Postgres; output seen in this session, not saved to a log):
      - `("y".repeat(199)+"😀z").slice(0,200)` followed by `JSON.stringify` gives `…\ud83d"`.
      - Postgres answers `select '[{"name":"a\ud83d"}]'::jsonb` with `ERROR: invalid input syntax for type json`.
      - mailparser 3.14.1 returns a 410-character `Return-Path` address uncut.
      - A 410-character value against a `<= 320` check gives `violates check constraint`.
    - **Reach.** Any external sender controls attachment file names. A user can also put any mail into INBOX with IMAP APPEND.
    - **Fix in the plan:**
      - Cut by code points, or call `.toWellFormed()` after the cut.
      - Add `returnPath: 320` to `CAPTURE_LIMITS`.
      - Run the header insert in a savepoint; a database error counts as `captureMissing`.
      - Add stage 01 and stage 05 tests: an attachment name with an emoji across character 200, and a 400-character `Return-Path`.
    - **Pre-mortem.** Stage 01 lets the bad value through. Stage 05 test 4 does not catch it, because no test makes the header insert fail.
    
    ## Unverified
    
    - I did not run lint, typecheck, unit or integration tests. The change holds only plan text, so they would not show anything about it. `bun install --frozen-lockfile` ran clean.
    
    ## Notes (non-blocking)
    
    **Conflicting rules and steps a Sonnet worker would have to guess**
    
    - **N1 (proven).** `stage-02:66` says "`mail-sync.test.ts` … pass unchanged". Two other rules say the opposite: `plan.md:138` ("fixes every caller … every test") and `stage-02:13` ("every other caller"). `grep` shows `fetchBodyText` more than 20 times in `test/integration/mail-sync.test.ts` and in `mail-backfill.test.ts:154,256`, including `failOn("fetchBodyText")`. Neither file is in the step 2 file list.
    - **N5 (proven).** `stage-11:40` reads sender rules for "the row's mailbox". The hidden-move row type in `stage-10:78` has no `mailboxId` field.
    - **N6 (proven).**
      - `stage-14:134` uses `membership.digest_times` for each `run.members` entry, but `LinkedChat` (`channels/port.ts:23-30`) has no digest times, and the step does not say where they come from.
      - `stage-14:122` gives `testMail` to `buildDigestMessage` but does not wire it into the deps of `digest-job.ts`.
      - `stage-11:40` calls `goNoGoFor(db, ctx, mailboxId, now)`. That call will need the test-mail rule after F097 stage 01 changes `listLabeledResults`.
    - **N7 (plausible).** Some fixture values are missing:
      - Triage result `created_at` times in `stage-10:30-44`; the e1 `wrongWithin7Days` value depends on them.
      - Times of org B's mails (`stage-10:46`). A quiet-hours time breaks `m5.urgent = 2` in `stage-11:50`.
      - The content of the 9-byte PDF in `stage-01:91`.
    - **N12 (proven).** D18 (`plan.md:57`) says every metric reads real mail only. D16 (`plan.md:55`) counts every `llm.call` row, test mail included.
    - **N13 (proven).** The same item has different texts or names in the plan and the stages:
      - Event name: D4 `capture_failed` (`plan.md:43`) against `capture_missing` (`stage-05:70`).
      - Pause text: D8 (`plan.md:47`) against `stage-07:77`.
      - Answered-check text: D22 (`plan.md:61`) against `stage-13:40`.
    
    **Gaps and risks in the design**
    
    - **N2 (plausible).** `contentFromSource` returns null on any error (`stage-01:69`), and `bodyTextFromSource` becomes a wrapper around it (`stage-01:84`). An exception in the link or header code then drops the body text as well. Catch capture errors on their own and keep the text.
    - **N3 (plausible).** The flag refresh reads mail up to 30 days old (`plan.md:45`), but a rescan after a UIDVALIDITY change covers only 7 days (`sync.ts` `RESCAN_WINDOW_MS`). Rows 7–30 days old keep old UIDs, and the guarded write in `stage-06:53` still matches them. They then get the flags of other mail, which is the poisoning risk that `stage-06:3` itself names.
    - **N4 (proven by reading `sync.ts:281`).** Stage 05 test 4 (`stage-05:80`) forces `CursorMovedError`. That check runs before any insert, so the test does not prove a rollback "after the email insert".
    - **N14 (proven, `triage/gate.ts:11-18`).** M8 is not limited to a week. `goNoGoFor` reads all labels at `now`, so all 8 columns of the stats page show today's evidence. The Monday "Auto:" line (`stage-14:49`) also lists the rows of all mailboxes without mailbox names.
    - **N15 (plausible).** `m8 … .max(50)` (`stage-09:156`): an organization with more than 10 mailboxes fails `weekStatsSchema.parse`, which breaks both the route and the weekly report. `max_mailboxes` has no upper check.
    - **N16 (plausible).** If the queue of the weekly row keeps failing, the detector recomputes `weekStats` on every tick for the whole Monday (`stage-14:134`), and `warnSkipped` warns only once.
    - **N17 (plausible).** `/status` and the digest can show "paused" for up to 2 h after one soft error (D8 window, `stage-07:82`). The real pause is 5 min (`triage/pause.ts`).
    - **N18 (plausible).** The reason line `✖️ Rejected ${time}` (`stage-12:31`) prints the time of the reason tap, not the time of the reject.
    - **N19 (plausible, privacy).** D5 (`plan.md:44`) keeps `auto_submitted` and `precedence` after retention. These are raw header text of up to 100 characters that the sender controls. Normalize them to a token, or clear them with the other texts.
    
    **Differences from the product decisions**
    
    - **N8 (proven).** D8 and Q4 ship the pause line in `/status` and the digest without a flag (`plan.md:47`, `questions.md:10`). This goes against P9 (`plan.md:25`) and PD-068 (`decisions.md:74`), which say new user-visible behaviour ships behind a flag.
    - **N9 (proven).** PD-066 (`decisions.md:72`) asks for each `auto` category's holdout result, history check, tripwire state and real-label precision "when 30+ labels exist".
      - `stage-14:49` prints precision at any label count.
      - The holdout result is moved to E4-B (`plan.md:56`, S2) and is not in `questions.md`.
      - The epic page's M8 also includes recall (`E03-measured-core.md:15`); the plan has none.
      - M6 is missing from the epic exit "M1–M8" (`E03-measured-core.md:44`), and the plan gives no reason.
    - **N10 (proven).** PD-127 (`decisions.md:133`) counts "surfaced" by the due day. D12 (`plan.md:51`) uses due + 1 working day. This is not in `questions.md`.
    - **N11 (proven).** C6 (`plan.md:179`) calls the first weekly report the E5 second-pass trigger. E5 expects due loops per day, median reply time and the share of replies that only promise (`E05-discovery-notes.md:107-109`), and E3a produces none of them. The seams list also leaves out the E11 suggestions line (PD-108, `decisions.md:114`).
    
    **Size, sequencing and operations**
    
    - **N20 (plausible).** Some stages are too big for one job:
      - Stage 10: a 13-mail fixture in 2 organizations, 8 readers in 5 modules, 11 cases.
      - Stage 12: 3 layers and 5 test files.
      - Stage 14: core, a migration, the detector, the digest and docs.
      - `channels/callbacks.ts` is already 393 lines, and stages 12 and 13 add to it with no split rule (F13 at `plan.md:97` names only `sync.ts` and `triage/repo.ts`).
    - **N21 (plausible).** Stage 08 may add `wilsonInterval` before F097 stage 14, which declares the same function without a check (`F097 stage-14:17`). The second one to land then has a duplicate export.
    - **N22 (plausible).** C4 says to "restart" after a `.env` edit (`plan.md:177`). `deploy/README.md:96,275` uses `$C up -d server`, which reloads the file, and says "Only the user edits `.env`".
    - **N23 (proven, board drift; not repaired).** `spec/build.md:38` still says "🔴 PLANNED, needs plan".
    
    ## Recompute (stages 08–11 and 14): all match
    
    - **Wilson:** (0,1) upper 0.7935; (10,10) lower 0.7225; (5,10) 0.2366 / 0.7634; (189,189) lower 0.98008; (40,41) lower 0.8741.
    - **Stage 08:**
      - M1: important 7, misses 3, sample 2 / 1 / 0.
      - Weeks and DST: the week of 2026-10-19 has 169 h.
      - M2: 5 / 2 / 3 / 0, pending 1.
      - M3: total 8.
    - **Stage 09:** M4 8 / 2 / 1; p90 = 6; M7 0.1436 and 1.0204.
    - **Stages 10–11:**
      - Truth rows: 9.
      - M1 5 / 1; M2 2 / 1 / 2; M3 2 / 1 / 0 / 1 = 4, no reason 1; M4 9 / 3 / 0; M5 2 / 1 / 1 / quiet 1 / p90 3.
      - M7 0.41115; weeks 11-16, 11-09, 11-02.
    - **Stage 14:** "20% (1 of 5)", "33% (3 of 9)", "$0.41", "lower bound 87%", "Mon 16 Nov – Sun 22 Nov".
    - **Checked against the code:** every named function and path exists at HEAD, and fact F1 (mailparser) is confirmed.
    
    ## Checks run
    
    - `git rev-parse HEAD` gives dfd0e00ab587385f794e7ffe3c994f7df016dac2.
    - `bun install --frozen-lockfile`: 967 packages, OK.
    - mailparser probe of the F1 message (`/tmp/f100-review/probe.ts`): confirms F1. A second probe shows that a long `Return-Path` stays uncut.
    - node `JSON.stringify` with a lone surrogate gives `\ud83d`.
    - A throwaway Postgres (`initdb` in `/tmp/f100-review`, port 54399): the lone-surrogate cast to jsonb fails, the check on 320 characters fails, and a `\u0000` cast to jsonb fails.
    - Many `grep` and `sed` reads of the code at HEAD.
    
    Verdict: FAIL, 1 blocking finding and 23 non-blocking findings.
    
    ## Note check
    
    - Final message line 1 is `FAIL <sha>` and the message ends with the verdict and the counts: proven. `/tmp/f100-review/review.md` (line 1, last line before this section).
    - Each finding quotes file:line and a label: proven. `/tmp/f100-review/review.md` § Blocking and § Notes.
    - Fixture answers of stages 08–11 and 14 are recomputed: proven. `/tmp/f100-review/review.md` § Recompute.
    - Decisions are checked against PD-056 to PD-069 and the E3 epic page: proven. `/tmp/f100-review/review.md` N8, N9, N10, N11.
    - Easy-to-miss rule (blocking only for a proven break of an acceptance bullet; plausible never blocks): not proven. B1 is the only blocking finding, and it names acceptance 3. The node, mailparser and Postgres probe outputs were seen in this session but not saved to a log file. Only the script `/tmp/f100-review/probe.ts` and `/tmp/f100-review/pg.log` exist. Every plausible finding is a note.
  finish-webhook:
    configured: no (this job sends no finish webhook)
    event: limen-finish-74da9ee98f4303c8e0fe214f156ed9b486dce4f1fb5d9a1860f8d41fff909169 (the ID the receiver uses to match this finish)
    handoff: Job done with open checks. Next step: decide each before you land: continue the job, start a review, or accept it with a reason. (open-checks lists them)
    author: unavailable · missing Ticket: pointer
    transport: unknown (no record that Limen sent the webhook to any target)
    bot-turn: unobserved (no trusted export shows that a receiving bot finished a turn for this event)
```
