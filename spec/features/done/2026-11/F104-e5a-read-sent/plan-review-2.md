# F104 plan review 2 (refresh 1)

> Cold review job `2026-11-14-f104-plan-review-refresh-1-f1228a6b` (Opus 5.5, high, fresh context) on candidate `550ff549`. Filed whole: the job's final message (`limen jobs <id>` result).

PASS 550ff54988fd448fa7224e5c4e7475016fa8875e

I found no proven break of a ticket Acceptance bullet. Seven findings should be fixed before stage 01 starts: N1–N4, N7, N9 and N13. Each of them would let a bug or a wrong guess through.

HEAD = 550ff54988fd448fa7224e5c4e7475016fa8875e (matches the candidate). The tree is clean.

## Unverified checks
- I ran no test suite. This is a plan-only review. I read the F106 tests to check F7. I did not run them.
- I did not open or verify the E05 discovery notes quote, PD-115–PD-117 or the ADR text in full, except §4.1 line 67.

## Pre-mortem: which stage lets a bug reach the user

**N1 (proven gap): stage 12 does not decide whether the encrypted find report holds the sent mails that go.**
- `apps/server/src/modules/privacy/dsr.ts:72-101` `reportChunks`: the report holds "the whole mail of each mail that goes". It reads only `emails`.
- `docs/capabilities/account-data.md:28` makes the same promise.
- `stages/stage-12-dsr-sent.md:13-16` adds `DsrMatch.sentMails`, the counts, the audit field and the CLI lines. It says nothing about the report.
- Effect: the erase deletes the person's sent mail, but the access copy that the operator hands over does not contain it.
- Fix: a decision and a test. Either the report gets a `sent_mails` array (ids, `sent_at`, to, cc, subject, body_text), or the plan states why it does not.

**N2 (proven gap): `dsrIsEmpty` is not in stage 12.**
- `dsr.ts:41-51` checks every count. `scripts/org-dsr.ts:39` prints "warning: no match, check the spelling of the address".
- Stage 12 adds `DsrCounts.sent_mails` (line 15) but does not say that `dsrIsEmpty` must check it.
- Effect: a person who appears only in sent mail gets a "probably mistyped" warning.
- Fix: add one test case.

**N3 (plausible): stage 01 tests conflict with stage 12.**
- `stages/stage-01-migration.md:57-58` test 12/13: "a sent row with the person in `cc_addresses` and `subject`". After the erase, test 13 expects "that row loses the address in both".
- The minimal row of line 35 has `from_address` null and `to_addresses {}`. Under the stage 12 rule (`stage-12-dsr-sent.md:14`, every other address is own; true when there is no other address), that row goes instead of being scrubbed.
- The stage 12 worker must then change a stage 01 test, but `plan.md:108` says "A gap or a deviation is a question".
- Fix: stage 01 test 12 names a non-own party (for example `q@x.test` in `to`).

**N4 (plausible): stage 11 can send a false `sent_missing` notice after a flag-off period or a mailbox pause.**
- D15 (`plan.md:73`) and the stage 11 step 3 rule (`stage-11-notice.md:51`) count quiet time from `max(newestUserAt, firstPassAt)`. They never check that a pass ran recently.
- `edge case 1` (`plan.md:80`) and the stage 13 rollback (`stage-13-pilot-deploy.md:50`) turn the flag off for days. While it is off, no pass runs.
- When the flag goes back on, or a `paused`/`host_blocked` mailbox goes back to `active`, the detector can run before the next `mail.sync`. Each owner then gets "No sent mail seen since …" for mail that was sent but not read yet.
- No rule covers this event.
- Fix: a decision, for example "`last_pass_at` within the last hour", or quiet time measured up to `last_pass_at`. Add a test case to stage 11 step 3.

**N5 (proven, ticket drift):**
- `ticket.md:35` says "One worker job per stage, 01 → 12 … Stage 12 is a coordinator runbook". Stage 12 is now the DSR worker stage and stage 13 is the runbook.
- `ticket.md:22` (Out of scope) still says that F106 owns the DSR map. `plan.md:46` admits this line is outdated but leaves the ticket as it is.
- `ticket.md:24-31` (Acceptance) has no bullet for D18 or stage 12. `plan.md:104` "Done when" ties the plan to the ticket Acceptance. So the sent-mail DSR behaviour has no acceptance line.
- `ticket.md:40` "Build after" lacks F106. Stage 01 and stage 12 change F106 code, and F106 is still in `spec/features/active/`. Its code has landed and it was deployed 2026-11-14 (`spec/features/active/F106-…/plan.md:130`).
- I did not change the ticket. This needs a ticket edit in the planned lane.

## Size-cut losses (vs `git show 1f5f4650~1:…`)

**N6 (proven regression): the stage 10 test path is wrong.**
- `stages/stage-10-panel.md:7` puts the unit test of `apps/web/src/lib/sent-text.ts` in `apps/server/test/integration/sent-text.test.ts`.
- The old file had `apps/web/src/lib/sent-text.test.ts` (old stage-10 line 11). That folder is the `test:unit` lane (`package.json:15`), and every other `apps/web/src/lib/*.test.ts` lives there.
- Effect: the test moves to the DB lane and imports web code from the server tests.

**N7 (proven): source paths were dropped from facts in `plan.md:89-96`.**
- F2 (`folder_map.sent` from `\Sent` / the committer's `Sent` / Interia `Wysłane`) has no source. The old F3 cited `connect.ts` `SPECIAL_USE_KEYS`, `committer.ts` `DEFAULT_PATHS` and the Interia note.
- F3 "System mail carries the draft id" has no source. The old F20 cited `actions/drafts.ts` `draftActionId` and `actions/send.ts` `saveSentCopy`. D6 depends on this fact.
- F6 (layers) lost `layers.json`. F9 "`mail.sync` runs once at a time" lost `platform/scheduler.ts`.
- I checked F2, F3 and F9 in the code (`connect.ts:39`, `drafts.ts:35`, `scheduler.ts:31`). The facts hold. Only the sources are missing.

**N8 (proven): reasons and one edge case were dropped.**
- The plan-size rule (`.agents/limen/planner.md:35`) keeps "decisions with reason and rejected option". D8, D9, D12, D13, D15, D16 and D17 now have neither.
- D15 lost "an error has its own card line; the notice's question would mislead".
- D14's reason survives only in Q2.
- Old edge case 4 ("when the committer later creates `Sent`, the next run starts a first pass there") is gone. Stage 04 has no test for `no_folder` → a folder that appears later (state `path` null → `resetSentCursor`).
- The old rule "No bare codes in code comments (`D4`, `F104`, `PD-116`)" and seam S8 (E2b scripted Sent APPEND) are gone.
- The test lists are otherwise the same (I compared case by case for stages 01–05, 08, 10 and 11).

## Rules that conflict

**N9 (plausible): `plan.md:126` U1 says the switch is consent, "never by CLI". Stage 09 (`stage-09-settings-api-and-cli.md:58-59`) gives the operator `sent-sync --value on`.**
- An operator can give the consent for the owner, and the audit row shows only actor `cli`.
- D11 and Q9 do not decide whether the CLI may turn the switch on.
- Fix: decide either off-only for the CLI, or on with a stated reason and a question entry.

**N10 (plausible): D18 and stage 12 go beyond the owner rule.** E05 notes line 67 says only "the new columns join the DSR address map … and the org-delete test". Deleting sent mail and tombstoning it is a planner extension. Q11 marks it `[important: privacy]`, so this is visible. I record it so that the coordinator counts Q11 as a new owner-facing default.

## Steps where a Sonnet worker must guess

**N11:** the F106 test pins `expect(MESSAGE_TABLES).toHaveLength(7)` (`privacy-dsr-match.test.ts:194`). Stage 01 step 3 (`stage-01-migration.md:50-52`) does not say whether `sent_emails` joins `MESSAGE_TABLES` (`address-map.ts:61-69`).

**N12:** `stage-01-migration.md:52` says "let the shape type say 'no mail column'". `dsr-match.ts:123` puts `shape.emailId` into SQL, so the worker must design that type change. Stage 12 then needs a separate "sent mail that goes" filter for mentions (`stage-12-dsr-sent.md:14`). Neither stage names that filter as an interface.

**N13:** stage 12 test 3 (`stage-12-dsr-sent.md:30`) seeds S1 "by `insertSentEmails`" and then expects that the fake's copy of S1 meets the tombstone.
- The dedup key includes `contentHash(from, date, size)` (`sync-rules.ts:15-24`).
- A hand-written key such as `mid:<s1@x.test>:h1` never matches the fake's meta, and the test fails for a wrong reason.
- Fix: the stage says to build S1 from the fake meta with `toNewSentEmail`, or to store S1 by a first pass.

**N14:** stage 11 adds a `NoticeKind`. `NOTICE_MAIL_CONTENT` (`privacy/outbox.ts:19`, typed `Record<NoticeKind, …>`) then fails typecheck until the kind has a class. Stage 11 step 1 and step 3 do not name the class (`no_mail`, as `host_blocked`, line 32).

**N15:** stage 10 (`stage-10-panel.md:16`) returns `vars.at`, but the texts use `{time}` (line 31). The mapping (`at` → `formatClock` → `{time}`) is left to the worker.

**N16:** `renderSentMissingNotice` (`stage-11-notice.md:24`) puts the mailbox address in the first line. The `host_blocked` renderer cuts it to 60 characters (`packages/core/src/digest/notices.test.ts:126-135`). Stage 11 has no long-address case.

## Stages that may be too big

**N17 (plausible):**
- Stage 11 has 4 steps across `packages/core` and `apps/server`, a migration and 14 tests.
- Stage 09 has a core schema, a view, a route, wiring, a CLI subcommand, `show` and 15 unit, integration and subprocess tests.
- Stage 04 has 17 integration cases on one `[risky]` function.
- Each one fits the 700-word limit (`wc -w`: 694, 691, 699), but each is the largest in its kind. Review 1 called a split optional. I agree that one job each is possible, but stage 11 is the first one I would split (core and migration / detector).

## D18 and stage 12 checked against the code
- F7 holds. `privacy-export-map.test.ts:44` test 1, `privacy-dsr-match.test.ts:161` test 1 (`tenantColumns` and `NO_PERSONAL_TABLES`), `account-data-delete.test.ts:231` test 1 and `:420` test 9 (a table with `dedup_key` + `message_id%` needs the trigger `emails_skip_tombstoned`), and `dsr-match.ts:117` throws without a `ROW_SHAPE`.
- The trigger function (`db/migrations/20261114160001_account_data.sql:49-61`) reads only `NEW.org_id` and `NEW.dedup_key`, so it works on `sent_emails` as stage 01 says.
- The stage 01 registry covers all 16 text/array columns of `sent_emails` (from, to, cc, subject, body_text plus 11 `NOT_PERSONAL`). `mailbox_sent_sync` → `NO_PERSONAL_TABLES` fits test 1.
- The org delete reaches both tables by the mailboxes cascade (`delete_organization` deletes `organizations`; FK `(mailbox_id, org_id)`). The DELETE_SEEDS `base` pattern fits.
- The erase order: `erase.ts:173` locks `mailbox_folders` and then matches. Stage 12 adds the `mailbox_sent_sync` lock after it.
  - The Sent pass writes `sent_emails` only under that lock (D5).
  - The text step is not under the lock. Its write guard `content = 'pending'` (stage 02 `writeSentText`) means a text write that waits on the erase does nothing after step 5 (`pending` → `headers_only`), and after a delete.
  - No lock cycle: the pass never takes a folders lock.
  - The claim in `stage-12-dsr-sent.md:19` holds.
- Rows that are new and kept (not tombstoned) and that a chunk planned before the erase inserts after it keep the person's address. This is edge case 13 / the F106 limit, and it is documented.
- Note: after an erase deletes an incoming mail, its actions go too. A kept system send that a later off → on pass reads again gets `sentOriginOf` null, and so it becomes user mail with text (`actions/repo/planned.ts:12-29` joins `emails`). This is a small, documentable limit.

## Checks I ran
- `git rev-parse HEAD && git status --short && ls /tmp/f104-old/plan.md` → 550ff54988fd448fa7224e5c4e7475016fa8875e, empty status, the old copy exists.
- `wc -w plan.md stages/*.md` → plan.md 1498; stages 532–700 (all ≤ 700).
- `git show 1f5f4650~1:<each file>` into `/tmp/f104-old/`, then a compare of the numbered tests per stage and of plan.md D1–D17, the edge cases, the facts, the rules and the seams.
- Read: `privacy/dsr-match.ts`, `erase.ts`, `dsr.ts`, `address-map.ts`, `delete.ts`, `outbox.ts` (grep), `export-map.ts` (head); `account-data-delete.test.ts` (seeds, tests 1 and 9); `privacy-dsr-match.test.ts` (test 1 helpers); `20261114160001_account_data.sql`; `20261114100002_rls_tenant_policies.sql` `delete_mailbox`; `mail/jobs.ts` `syncOne`; `mail/sync-rules.ts`; `retention.ts`; `actions/repo/planned.ts`; `fixtures.ts` `insertDraftAndSend`; `scripts/org-dsr.ts` (grep); `docs/capabilities/account-data.md` (grep); `E05-discovery-notes.md:67`.
- Fact checks: F8 (14 kinds, newest migration `20261114170001_sso.sql`) holds. The `SENT_BODY_TEXT_LIMIT` claim "the same as the incoming limit" holds (`sync.ts:55`, `capture.ts:9` = 100_000). Precedent for "one colon besides the clock" in a Polish text: `mb_last_sync` (`apps/web/src/i18n/pl.ts:179`).

## Note check
- Verdict line and HEAD = candidate: proven. `git rev-parse HEAD && git status --short && ls /tmp/f104-old/plan.md` printed 550ff54988fd448fa7224e5c4e7475016fa8875e.
- Finding coverage (file and line, label, the asked classes): proven. This message: the pre-mortem, gaps (N1, N2, N4), rule conflicts (N3, N9, N10), worker guesses (N11–N16), facts without a source (N7), size-cut losses (N6, N8), stages too big (N17), and ticket drift (N5). The old version is in `/tmp/f104-old/plan.md`.
- D18 and stage 12 checked against the privacy code and the F106 tests: proven by the files cited above: `apps/server/src/modules/privacy/erase.ts`, `apps/server/src/modules/privacy/dsr-match.ts`, `apps/server/src/modules/privacy/dsr.ts`, `apps/server/test/integration/account-data-delete.test.ts`, `apps/server/test/integration/privacy-dsr-match.test.ts`, `db/migrations/20261114160001_account_data.sql`.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a missing decision, test, interface, edge case or source. None asks only for line numbers, edit text or a file list. N6 is a wrong test lane (an interface), not a missing line number.
