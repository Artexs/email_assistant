# F104 plan refresh 1

- Old base: `f36794e` (2026-11-14 12:46). New base: `560e74e7` (HEAD at the job start, 2026-11-14 23:52). Refresh date: 2026-11-15.
- Job: `2026-11-14-f104-refresh-plan-drift-before-t-c5b99e64`. No code, no migration, no `test:int`.
- Also applied: the lean-plan sizes of `.agents/limen/planner.md` § Plan size (plan.md at most 1,500 words, each stage at most 700). Detail that the worker finds at `HEAD` (line numbers, copies of code, edit text) went out; decisions, edge cases, interfaces, schema shape and numbered tests stayed.

## Drift output

`bash scripts/plan-drift.sh spec/features/planned/F104-e5a-read-sent f36794e` (run on the plan as it was before this refresh; the HEAD line shows the time of the re-run, the code paths are the same):

```
plan base: f36794e5 2026-11-14 12:46
HEAD:      85c19789 2026-11-15 00:12
named paths: 85; changed since base: 34; gone: 0
changed: apps/server/src/main.ts
changed: apps/server/src/modules/actions/index.ts
changed: apps/server/src/modules/actions/repo/index.ts
changed: apps/server/src/modules/audit/repo.ts
changed: apps/server/src/modules/channels/notices/index.ts
changed: apps/server/src/modules/channels/repo.ts
changed: apps/server/src/modules/layers.json
changed: apps/server/src/modules/mail/connect.ts
changed: apps/server/src/modules/mail/index.ts
changed: apps/server/src/modules/mail/jobs.ts
changed: apps/server/src/modules/mail/repo/index.ts
changed: apps/server/src/modules/mail/sync.ts
changed: apps/server/src/platform/db/schema.ts
changed: apps/server/src/platform/log-fields.ts
changed: apps/server/src/retention.ts
changed: apps/server/src/web.ts
changed: apps/server/test/integration/channels-notices.test.ts
changed: apps/server/test/integration/mail-jobs.test.ts
changed: apps/server/test/integration/mail-remove.test.ts
changed: apps/server/test/integration/retention-job.test.ts
changed: apps/server/test/integration/rls-policy.test.ts
changed: apps/server/test/integration/telegram-schema.test.ts
changed: apps/server/test/integration/tenancy-features.test.ts
changed: apps/server/test/integration/web-settings.test.ts
changed: apps/web/src/i18n/en.ts
changed: apps/web/src/i18n/pl.ts
changed: deploy/README.md
changed: packages/core/src/digest/notices.ts
changed: packages/core/src/features.ts
changed: packages/core/src/notices/kinds.ts
changed: packages/core/src/notices/registry.test.ts
changed: packages/core/src/notices/renderers.ts
changed: packages/core/src/notices/views.ts
changed: packages/core/src/texts/notices.ts
commits after the base that touch the named paths:
  e5708eeb 11-14 22:35 F119 stage 02: SSO migration (sso_providers, sso_required, session sign-in method and 12 h cap)
  c5334c40 11-14 21:43 deploy README: export folder owner, run with the host user ids (found at the F106 VPS check)
  83fd450b 11-14 20:31 F106 stage 10: account data docs, runbook and capability page; pl text 'błędne hasło' for the refused-delete kind
  0a5bf4d2 11-14 20:27 F106 stage 10: security-log kinds for export, refused delete and data requests (en, pl)
  46c99d30 11-14 20:16 F106 stage 09 N1: the erase closes and blanks waiting approval sets whose sends all closed (shared predicate with the resume hook)
  98f21fe9 11-14 19:45 F106 stage 08 review fixes: open-action re-check under the mail lock, quote and brace boundary, chain lines in --find, tenant scope for find and erase, ordered audit helpers
  f396e047 11-14 19:14 F106 stage 08: org:dsr --erase, multi-level chain actions, json and = pattern fixes, read-only pin of the find
  84a6626f 11-14 18:50 F106 stage 04 review fixes: no delete block without the flag (B1), pending marker for the redirect race (N2), del_failed_unknown (N3), deleteError in errors.ts (N8), Polish wording
  e30de3ab 11-14 18:38 F105 stage 14: docs for two-factor sign-in, break-glass owner, ADR 0026 amendment, deploy guide, alerts
  96a2dbaa 11-14 18:30 F106 stage 04: delete dialog in the Account card and the notice on the login page
  9cf374a6 11-14 17:58 F105 stage 11: review fixes (stale without-codes warning, focus per view, two Polish wordings)
  685d32b8 11-14 17:51 F106 stage 03: DELETE /api/organization (owner, flag org_delete, password and typed name, lockout)
  92871ea2 11-14 17:42 F085 s07: docs for host_blocked (capability pages, architecture, modules, known alert, deploy runbook and rollback)
  c57ebba0 11-14 17:39 F105 stage 11: two-factor section in the Account card (enrol, backup codes, turn off), single-flight submit
  f4a36194 11-14 17:31 F085 s06: mailbox:check prints the status and the host check and makes no connection to a refused host; stage 05 carry-over tests
  496bc31e 11-14 17:29 F105 s10: uqr QR helpers, TotpQr component, account two-factor error map
  081d894b 11-14 17:17 F105 stage 09: review fixes (Polish wording, backup-codes-not-enabled map, error aria-describedby)
  91e891d8 11-14 17:14 F106 stage 02: privacy module, deleteOrganization with user lock, org:delete CLI, flat audit guard
  d35592a8 11-14 17:05 F085 s05: a refused host blocks the mailbox at sync and send time, with an end-to-end test; the re-check reopens only the episode it read
  b1d8512b 11-14 17:04 F105 stage 13: fix prettier and test data type
  089febd1 11-14 16:57 F105 stage 13: security log kinds for two-factor and break-glass events
  fe70f317 11-14 16:57 F105 stage 09: login code step (client plugin, error helpers, LoginPage)
  e972e435 11-14 16:43 F085 s04: the host re-check reopens a blocked mailbox, and a password change does too
  2bcbc2bb 11-14 16:43 F105 stage 08: GET /api/me/two-factor and the backup-code count
  70a8cd0c 11-14 16:38 F106 stage 01: delete_organization, dsr_tombstones, emails_skip_tombstoned trigger
  e8dd7bcb 11-14 16:25 F085 stage 03: server readers name host_blocked (pause, expiry, /status, taps, operator count)
  c3761671 11-14 16:21 F105 stage 07: operator reset of the second factor (resetTwoFactor, web:two-factor-reset)
  8a2343e8 11-14 16:15 F085 stage 02: tenant test for host_blocked notices; plain comments
  3326dce7 11-14 16:03 F100 stage 19: last docs pass, stats_evidence_few_auto
  54b1c4eb 11-14 15:49 F085 stage 02: host_blocked mailbox status and notice kind
  6147a377 11-14 15:36 F105 s06: the break-glass owner cannot turn TOTP off
  4b51fcff 11-14 15:16 F085 stage 01: Polish hostBlocked notice lines hold at most one colon (plan D9 and stage 01 updated)
  47943889 11-14 15:13 F029 s04: run the move finder after a flag refresh with gone mail; test 8.4 pins the fix
  7eaae28b 11-14 15:06 F100 stage 17: weekly report detector and the handled-share digest line
  bb5cc21f 11-14 15:03 F085 stage 01 step 3: panel badge and hint for host_blocked (mailboxStatusUi)
  6bebc1ec 11-14 15:03 F085 stage 01 step 2: texts of the host_blocked notice and the bot, renderHostBlockedNotice
  32646cc0 11-14 14:52 F105 stage 05: break-glass owner service and org:break-glass CLI
  8429dc55 11-14 14:44 F029 s03: findUserMoves, the move finder for gone mail
  4137154b 11-14 14:41 fix(f098-s12): order-free sender test; one colon per composed Polish line, one style; composed guards; 7-day note for old cards
  7f713bf9 11-14 14:38 F100 s18: hide M8 precision below 30 labels; stale and missing mailbox states; Polish wording
  65939518 11-14 14:26 F029 stage 01: the folder check tries every free copy, first gone wins
  1ede2183 11-14 14:26 F029 stage 02: listMoveCandidates, location guards and matchMoved (F064)
  e158d64a 11-14 14:11 F100 stage 16: weekly report core (flags, notice kind, renderer, digest line) and outbox kind migration
  a14f4dcd 11-14 14:10 F100 s18: stats page (nav item, table, en and pl texts)
  1efa79c6 11-14 14:02 test: drop non-null assertions in the locale tests
  7ca35eb8 11-14 14:02 F100 s07: auth-error notice no longer claims a fixed retry interval (en, pl)
  8b45b9c3 11-14 14:02 F100 s15: answered check in /review (flag answered_check, ay/an taps, candidates and answer service, en and pl texts)
  c71fc69b 11-14 14:01 feat(texts): switch Telegram texts to the user locale; English fixtures; Polish text fixes (one colon per line); channels-locale tests
  4efddb26 11-14 13:52 F100 s07 step 3: deploy README LLM provider budget; known alert points to the pause line
  d3e7a370 11-14 13:52 F100 s07 step 2: LLM pause line in /status and the digest (flag llm_pause_line)
  c757cc51 11-14 13:48 F100 s07 step 1: MAIL_SYNC_EVERY_MIN sets the mail.sync interval (default 2)
  ad06e742 11-14 13:45 F105 stage 04: operators need TOTP (WebSession.twoFactorEnabled, requireOperator and /operator page guard)
  8e7cd8c6 11-14 13:43 F105 s03: 2FA audit rows, one lock row, trusted devices and sessions end at enrolment
  0562dcd1 11-14 13:38 F100 s06 review fixes: touch unread mail so it leaves the queue head (N1), one-sided Message-ID is a mismatch (N3), tests for N4 and N6
  b36ae676 11-14 13:37 F100 stage 12 step 2: GET /api/stats behind stats_page and bun run stats:week
  e8164ad7 11-14 13:22 F100 s14: reject-reason and mistake taps (Telegram), send-result button, two owner-only web routes
  3591d446 11-14 13:20 F100 stage 11: row readers of actions, delegation and audit; fixture inserts the settings row
  2215be22 11-14 13:20 F100 s06: import order in the sync job
  1bb727e9 11-14 13:18 F100 s06: flag refresh in the sync run (email_flags, guarded write, at most every 10 min per mailbox)
  276ba629 11-14 13:12 F098 stage 11: bot replies, taps, link replies and the command menu from texts.bot (en, pl)
  6e03f35d 11-14 13:05 F100 stage 13 step 2: recordRejectReason and markSentMistake in actions
  52964839 11-14 13:04 F100 stage 13 step 1: mistake_capture flag, rw and mk callbacks, reason buttons, mistake button
  a243d32b 11-14 13:00 F105 stage 01: two_factor migration (auth_two_factors, users.two_factor_enabled, memberships.break_glass)
  a25fbde2 11-14 12:59 F097 stage 10: eval case extension and the slot join
  80f0e745 11-14 12:59 F100 s05 step 3: retention clears captured header texts with the mail body
  19d31e0c 11-14 12:58 F100 s05 step 2: sync and backfill store the header capture in a savepoint
  bb16b317 11-14 12:56 F100 s05 step 1: email_headers repository (insert, get, clear)
  0e493553 11-14 12:37 F100 s04 step 2: answered_check feedback source, schema and RLS tests
  78e8c2eb 11-14 12:36 F097 stage 04: /review command behind the review_command flag
  524a02db 11-14 12:36 F100 s04 step 1: measure capture migration (email_headers, email_flags, action_feedback, answered_check source)
exit 1
```

After the refresh: `bash scripts/plan-drift.sh spec/features/planned/F104-e5a-read-sent 560e74e7` → `named paths: 85; changed since base: 0; gone: 0`, `no drift`, exit 0.

## Changes (stage, what, why)

- **Whole plan, stage count 12 → 13.** The F106 account-data code landed before F104 (privacy module, registries, tombstone trigger). The owner rule "the new columns join the DSR address map (E7-T3) and the org-delete test, whichever ticket lands second adds them" (E5 notes §4.1) now gives that work to F104. The code forces it: the F106 completeness tests fail for a new table. New decision D18; new questions Q11, Q12.
- **plan.md.** Status line `Plan base: 560e74e7, refreshed 2026-11-15`; D18; D11 names the audit event as no security-log kind (Q12); facts re-checked and cut to those a decision needs (F1–F9); edge case 13 (mail stored after an erase); stage list, review list, owner steps and How to run name stage 13 for the pilot; How to run step 1 uses the new base; the ticket's outdated "Out of scope" DSR line is named.
- **Stage 01.** New step 3 (registries): `EXPORT_MAP` entries, `DSR_ADDRESS_MAP.sent_emails` (recipients, equal, text rules), `NOT_PERSONAL` reasons, `NO_PERSONAL_TABLES.mailbox_sent_sync`, a `ROW_SHAPE` for sent rows. Step 1 adds the trigger `emails_skip_tombstoned` on `sent_emails` (F106 `account-data-delete.test.ts` test 9). Step 2 adds both tables to `DELETE_SEEDS` (test 1) and test 9 (a tombstoned key inserts nothing). Migration timestamp: later than `20261114170001_sso.sql`.
- **Stage 02.** `insertSentEmails`: a tombstoned key inserts nothing (the trigger). Size only otherwise.
- **Stage 03.** Size only; full paths.
- **Stage 04.** New case 17: a tombstoned mail gives no row, and the cursor still passes it.
- **Stage 05.** Size only.
- **Stage 06.** `docs/capabilities/sync.md` rule 5 also says "never reads … Sent" now: the stage changes it too. The pass sits next to the F100 flag-refresh block in `syncOne` (F100 stage 06 landed). `main.ts` line numbers dropped. Pilot reference → stage 13.
- **Stage 07.** Retention: `runOrg` now also runs `clearCapturedHeaders` (F100 stage 05); the sent clears join `RetentionCounts` and the per-org log line in its form at the base.
- **Stage 08.** The audit event stays out of the security-log registry (`packages/core/src/security-log.ts`, F099 and F105 kinds; Q12).
- **Stage 09.** Size only.
- **Stage 10.** No e2e case (as before); a later spec takes a free `nextAddress` block (F105 uses 50/150, F106 0/220; others include 20/120, 30/130, 80/180).
- **Stage 11.** The newest `outbox_kind_check` migration is `20261114154826_mailbox_host_blocked.sql` (14 kinds, last `host_blocked`; F100 `weekly_report` landed); `host_blocked` (F085) is the newest mailbox-notice example; a mailbox in status `host_blocked` gets no notice (case 7). Needs stage 10 (all stages run in order).
- **Stage 12 (new) `[risky]`.** Data requests for sent mail: F106 D9 applied to sent rows (a sent mail whose other parties are own mailboxes goes, with a tombstone), the erase locks `mailbox_sent_sync` rows (the pass's lock, D5), kept `pending` rows that name the person become `headers_only`, counts `sent_mails` in the audit data and the CLI.
- **Stage 13 (was 12).** F099 runbook path in `done/2026-11/`; sync interval `MAIL_SYNC_EVERY_MIN` (default 2, F100 stage 07); check 5 groups by `origin` (the old query used `action_id IS NOT NULL`, which counts the user's own sends of system drafts as system mail); "needs stages 01–12"; the trigger in the "only adds" list.
- **questions.md.** Q11 `[important: privacy]` (DSR rule for sent mail), Q12 `[minor]` (no security-log kind).

## Facts checked, no change needed

- imapflow is still 1.7.8 in `bun.lock` (the `bun.lock` change added `age-encryption` and `@better-auth/sso` only).
- `mail/port.ts` is unchanged: the five reader methods and the write methods are the same.
- `sync-rules.ts`: `normalizeMessageId`, `contentHash`, `baseDedupKey`, `threadKey`, `filterAboveCursor` unchanged (F029 changed only copy candidates); `fetchSince` still exported from `sync.ts` and typed `MailProvider`; the reserved map keys still hold `sent`.
- `isOwnActionId` is still in `actions/repo/planned.ts` and injected in `main.ts`; `insertDraftAndSend` exists in `fixtures.ts`.
- `layers.json`: `mail` and `config` share layer 2 (`mail → config` only); `actions` 3, `channels` 4, `operator` and `privacy` 5. No new module edge in this plan (privacy reads `sent_emails` by SQL, as it reads `emails`).
- `tenancy` split into `tenancy/repo/`: `getOrganization` is in `tenancy/repo/organizations.ts`; `isFeatureOn`, `upsertOrgFeature`, `configureFeatures` are exported by `tenancy/index.ts`; flag `sent_sync` exists, default off.
- `connectMailbox`, `auditEvents.mailboxConnected`, `setFolderMapEntry`, `getMailbox`, the settings view and routes (`sync-folders` pattern), `settingsRouteDeps` in `web.ts`, `mailbox-settings` CLI and its `describeSyncFolder`, `patchSettings`, `ConnectDialog`, `SyncFoldersCard`, `formatClock` use in `MailboxCard.tsx`, `me.features`: present as the plan uses them.
- `log-fields.ts`: a flat list; F103 stage 01 not landed (it added only `minutes`).
- The fake provider still has `deliver`, `remove`, `resetUidValidity`, `failOn`, `folderCalls`, `bodyLimitBytes`.
- `cancelPendingOutbox` keeps `exceptDedupKey`; its kind union now holds `host_blocked` too.
- No landed ticket built a step of this plan: no `sent_emails`, `mailbox_sent_sync`, `SentFolderReader`, `sentOriginOf` or `listUserAnswers` in the code.

## Review 2 answers ([plan-review-2.md](plan-review-2.md): PASS, 17 notes)

Cold review model: `claude-opus-5-5` (the plan has `[risky]` stages; refresh 1 changed stage 01 in substance and added stage 12).

- **N1 fixed.** Stage 12: the encrypted find report gets a `sent_mails` array; test 4 checks it.
- **N2 fixed.** Stage 12: `dsrIsEmpty` counts `sent_mails`; test 4b.
- **N3 fixed.** Stage 01 test 12: the row also goes to `q@x.test`, so stage 12 keeps it as a mention.
- **N4 fixed.** D15 and stage 11: no notice without a pass in the last hour (`SENT_PASS_FRESH_MS`); `SentHealthRow.lastPassAt` (stage 07); stage 11 test 9.
- **N5 outside edit.** `ticket.md` is not edited in a refresh (`.agents/limen/planner.md` § Refresh job step 6). The needed lines are in the job's final message: Slices (01 → 13, stage 13 runbook), Out of scope (DSR line), one Acceptance bullet for the sent-mail data request, Sequenced "Build after" (the F106 code on `master`). plan.md names the outdated line.
- **N6 fixed.** Stage 10: `apps/web/src/lib/sent-text.test.ts` (unit lane). The refresh's path expansion had put it in the integration folder.
- **N7 fixed.** F2, F3, F6, F9 name their sources again.
- **N8 fixed.** D8, D9, D12, D13, D14, D15, D17 have a reason or a rejected option; D15 keeps "the card names errors"; edge case 3 and stage 04 test 3 cover a Sent folder that appears later; the "no bare codes" rule and the E2b seam are back. D16 is a doc rule (no option to reject).
- **N9 fixed.** D11 and Q13: the operator may turn the switch on by CLI only on the owner's instruction; U1 says the pilot consent is the owner's tap.
- **N10 noted.** Q11 is `[important: privacy]`: the coordinator copies it to `docs/owner-decisions.md`.
- **N11 fixed.** Stage 01: `MESSAGE_TABLES` stays (pinned at 7; `sent_emails` does not cascade from `emails`).
- **N12 fixed.** Stage 01 names the `ROW_SHAPE` type (`emailId: string | null`); stage 12 names the second exclusion list of `findMentions`.
- **N13 fixed.** Stage 12 test 3 stores S1 by a first pass of the fake.
- **N14 fixed.** Stage 11: `NOTICE_MAIL_CONTENT.sent_missing = "no_mail"`.
- **N15 fixed.** Stage 10 names the render call (`vars.at` → `formatClock` → `{time}`).
- **N16 fixed.** Stage 11: the address is cut with `cutText(address, 60)`; test 1 has an 80-character case.
- **N17 rejected.** Stages 04, 09 and 11 stay one job each: each fits 700 words, follows one existing pattern, and stages 04 and 11 get a review job. A split would renumber the stages that other files name.
- **Limit (review note).** A system send whose incoming mail an erase deleted reads as user mail after a new first pass: stage 12 docs name it.

## Word counts (`wc -w`, after review 2)

```
 1499 plan.md
  678 stages/stage-01-migration.md
  700 stages/stage-02-repository.md
  658 stages/stage-03-rules.md
  700 stages/stage-04-header-pass.md
  579 stages/stage-05-text-step.md
  649 stages/stage-06-wiring-and-docs.md
  693 stages/stage-07-readers-and-retention.md
  532 stages/stage-08-switch.md
  697 stages/stage-09-settings-api-and-cli.md
  691 stages/stage-10-panel.md
  682 stages/stage-11-notice.md
  692 stages/stage-12-dsr-sent.md
  697 stages/stage-13-pilot-deploy.md
10147 total
```
