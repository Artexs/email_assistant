# F103 · plan refresh 1

- Old base: `0a5c2ee` (the commit the plan read the code at; the plan landed at `75d9c32` with no code change between). New base: `560e74e7` (HEAD, 2026-11-15). 1,010 commits between them.
- Method: `bash scripts/plan-drift.sh spec/features/planned/F103-e8a-logs 0a5c2ee`; then `eslint apps/server/src -f json` at `560e74e7` (main checkout's `node_modules`, same commit) for the old-form call list per file; then a read of each file and test that a stage names. The drift script sees only full paths (`apps/…`, `deploy/…`); the stages name module paths relative to `apps/server/src`, so the lint list is the main check.

## Drift output

```
plan base: 0a5c2ee4 2026-11-14 07:46
HEAD:      560e74e7 2026-11-14 23:52
named paths: 64; changed since base: 22; gone: 0
changed: apps/server/src/main.ts
changed: apps/server/src/modules/actions/committer.ts
changed: apps/server/src/modules/actions/expiry.ts
changed: apps/server/src/modules/channels/operator.ts
changed: apps/server/src/modules/channels/telegram/bot.ts
changed: apps/server/src/platform/http.test.ts
changed: apps/server/src/platform/log-fields.ts
changed: apps/server/src/scripts/mail-hosts-configured.test.ts
changed: apps/server/src/web.ts
changed: apps/server/test/integration/actions-committer.test.ts
changed: apps/server/test/integration/actions-expiry.test.ts
changed: apps/server/test/integration/actions-logs.test.ts
changed: apps/server/test/integration/actions-send-logs.test.ts
changed: apps/server/test/integration/channels-operator.test.ts
changed: apps/server/test/integration/channels-sender.test.ts
changed: apps/server/test/integration/telegram-logs.test.ts
changed: apps/server/test/integration/telegram-router.test.ts
changed: apps/server/test/integration/triage-logs.test.ts
changed: apps/server/test/integration/web-mailboxes.test.ts
changed: apps/server/test/integration/web-telegram.test.ts
changed: apps/web/src/i18n/en.ts
changed: deploy/README.md
commits after the base that touch the named paths:
  c5334c40 11-14 21:43 deploy README: export folder owner, run with the host user ids (found at the F106 VPS check)
  83fd450b 11-14 20:31 F106 stage 10: account data docs, runbook and capability page; pl text 'błędne hasło' for the refused-delete kind
  0a5bf4d2 11-14 20:27 F106 stage 10: security-log kinds for export, refused delete and data requests (en, pl)
  84a6626f 11-14 18:50 F106 stage 04 review fixes: no delete block without the flag (B1), pending marker for the redirect race (N2), del_failed_unknown (N3), deleteError in errors.ts (N8), Polish wording
  e30de3ab 11-14 18:38 F105 stage 14: docs for two-factor sign-in, break-glass owner, ADR 0026 amendment, deploy guide, alerts
  96a2dbaa 11-14 18:30 F106 stage 04: delete dialog in the Account card and the notice on the login page
  685d32b8 11-14 17:51 F106 stage 03: DELETE /api/organization (owner, flag org_delete, password and typed name, lockout)
  92871ea2 11-14 17:42 F085 s07: docs for host_blocked (capability pages, architecture, modules, known alert, deploy runbook and rollback)
  c57ebba0 11-14 17:39 F105 stage 11: two-factor section in the Account card (enrol, backup codes, turn off), single-flight submit
  f4a36194 11-14 17:31 F085 s06: mailbox:check prints the status and the host check and makes no connection to a refused host; stage 05 carry-over tests
  496bc31e 11-14 17:29 F105 s10: uqr QR helpers, TotpQr component, account two-factor error map
  081d894b 11-14 17:17 F105 stage 09: review fixes (Polish wording, backup-codes-not-enabled map, error aria-describedby)
  d35592a8 11-14 17:05 F085 s05: a refused host blocks the mailbox at sync and send time, with an end-to-end test; the re-check reopens only the episode it read
  b1d8512b 11-14 17:04 F105 stage 13: fix prettier and test data type
  089febd1 11-14 16:57 F105 stage 13: security log kinds for two-factor and break-glass events
  fe70f317 11-14 16:57 F105 stage 09: login code step (client plugin, error helpers, LoginPage)
  2bcbc2bb 11-14 16:43 F105 stage 08: GET /api/me/two-factor and the backup-code count
  e8dd7bcb 11-14 16:25 F085 stage 03: server readers name host_blocked (pause, expiry, /status, taps, operator count)
  3326dce7 11-14 16:03 F100 stage 19: last docs pass, stats_evidence_few_auto
  6147a377 11-14 15:36 F105 s06: the break-glass owner cannot turn TOTP off
  7eaae28b 11-14 15:06 F100 stage 17: weekly report detector and the handled-share digest line
  bb5cc21f 11-14 15:03 F085 stage 01 step 3: panel badge and hint for host_blocked (mailboxStatusUi)
  4137154b 11-14 14:41 fix(f098-s12): order-free sender test; one colon per composed Polish line, one style; composed guards; 7-day note for old cards
  7f713bf9 11-14 14:38 F100 s18: hide M8 precision below 30 labels; stale and missing mailbox states; Polish wording
  a14f4dcd 11-14 14:10 F100 s18: stats page (nav item, table, en and pl texts)
  c71fc69b 11-14 14:01 feat(texts): switch Telegram texts to the user locale; English fixtures; Polish text fixes (one colon per line); channels-locale tests
  4efddb26 11-14 13:52 F100 s07 step 3: deploy README LLM provider budget; known alert points to the pause line
  c757cc51 11-14 13:48 F100 s07 step 1: MAIL_SYNC_EVERY_MIN sets the mail.sync interval (default 2)
  ad06e742 11-14 13:45 F105 stage 04: operators need TOTP (WebSession.twoFactorEnabled, requireOperator and /operator page guard)
  8e7cd8c6 11-14 13:43 F105 s03: 2FA audit rows, one lock row, trusted devices and sessions end at enrolment
  b36ae676 11-14 13:37 F100 stage 12 step 2: GET /api/stats behind stats_page and bun run stats:week
  b64ae102 11-14 13:30 F097 s13: the mail host guard skips -load.ts loaders
  41d7827b 11-14 13:29 F097 s11: mail-hosts guard skips sim-commands.ts (no mail connection)
  84c0578d 11-14 13:28 F098 stage 11 review fix: Polish count texts follow the count; Polish style fixes; test for the failed locale read
  e8164ad7 11-14 13:22 F100 s14: reject-reason and mistake taps (Telegram), send-result button, two owner-only web routes
  276ba629 11-14 13:12 F098 stage 11: bot replies, taps, link replies and the command menu from texts.bot (en, pl)
  78e8c2eb 11-14 12:36 F097 stage 04: /review command behind the review_command flag
  4cb4e601 11-14 12:28 F099 stage 14: docs and standards (send limits, operator console, security log)
  72fc0aab 11-14 12:18 F098 s05: review notes: reset the consent tick, name the consent in the capability pages, reword the consent texts
  09491bb5 11-14 12:13 F099 stage 11.1: operator write helpers and texts
  49c8d391 11-14 12:09 F123: log server_listening after the signal handlers exist; unquarantine start-log test
  1e82ba94 11-14 12:06 F099 stage 10: operator page, nav item and view helpers
  6a57448c 11-14 11:48 F098 s05: Telegram link needs versioned consent; audit web.telegram_consent; panel checkbox
  9a0cc1e9 11-14 11:47 F099 s09: operator writes: POST /api/operator/orgs/:orgId/plan and /flags, orgPlanHooks shared with org:plan
  eb41e8a6 11-14 11:36 F097 s01 step 2-3: mailKindFilter and the synthetic scopes take the test sender rule
  b6fa717e 11-14 11:21 F099 stage 13: security log card in the Account card
  ff1efd65 11-14 11:11 F092 s03: fix import order
  483f0b53 11-14 11:10 F098 s04: language select in the Account card, panel follows users.locale
  9e120d68 11-14 11:06 F099 s05: notice send_held for sends held by a send limit
  f36f5f8f 11-14 11:05 F099 s07.2: GET /api/operator/orgs organization list
  0507fc54 11-14 11:05 F092 s03: requireTenant and requireOperator set and clear the tenant scope
  1c565771 11-14 10:57 F099 s04: operator notice send_limit; committer gets the configured send limits
  730f8273 11-14 10:39 F099 s03.1: hold a send over a limit in the committer under the mailbox lock
  bd47a38a 11-14 10:38 F099 s06.1: operator module in its own layer
  17c1b494 11-14 10:12 F098 s01 step 2: locale store, t and tp
```

## Counts at `560e74e7`

Old-form calls (`no-restricted-syntax`, severity warn): 416 in 75 files (395 in 71 at `0a5c2ee`). Scripts 228, channels 56, actions 40, mail 29, triage 28, roots 20, testmail 6, delegation 5, tenancy 4. `no-console` in `apps/server/src`: 0. `run … server bun` lines: 46 in `deploy/README.md` (32 before), 1 in `docs/known-alerts.md` (0 before).

## Changes (stage, what, why)

- plan.md: cut from 6,767 to under 1,500 words (`.agents/limen/planner.md` § Plan size); every P and D decision kept, shorter. Owner words, § Differences, § Facts checked (V1–V13), § Not verified and the cold review 1 record moved word for word to `plan-facts.md`. Status line: `Plan base: 560e74e7, refreshed 2026-11-15`. New D26 (below). D16 tables now hold `560e74e7`. D19: F098, F099, F100 are done; the F099 VPS-stage seam is gone; active overlaps are F097, F105, F106, F119. Stage list counts updated.
- All stages: line numbers and "known matches at `0a5c2ee`" line lists removed (the lean rule; most had drifted); tables became lists to fit 700 words. Each stage keeps its tests, interfaces and decisions.
- questions.md: Q8 `[minor]` (D26).
- Stage 01: the number list gains `minutes`, `mailbox_hour`, `mailbox_day`, `recipient_day` (added by F100 and F099 after the base); a rule for names added before the stage builds.
- Stage 02: counts unchanged (13 scripts, 55 calls). The import border text now names the current `borderZones()` form; no change of design.
- Stage 03: 11 scripts, 71 calls: `mailbox-signals.ts` (new, F100) has 1 old-form line; its event lines stay (D26). End check is the lint, not "no `createLog`" (the `mailbox-*.ts` glob would have failed).
- Stage 04: 14 scripts, 102 calls: `eval.ts` 8 → 9, new `eval-sim.ts` (15, F097). New D26: `org-delete`, `org-export`, `org-dsr`, `org-break-glass`, `web-two-factor-reset`, `stats-week` (F105, F106, F100) already log failures as events and print with `process.stdout.write`; their CLI tests match that text, so they keep `createLog`. The end check changes from "no script imports `createLog`" to "no old-form line in `scripts/`" (plan Done when 3). Forced by D23 and the tests.
- Stage 05: `operator.ts` 9 → 11 calls (two `send_limit` notice failures, F099); same code `operator_notice_failed`.
- Stage 06: no count change; facts re-checked (chat guard comment, `bot.catch`, grammY 1.46.0, `makeFake`/`setup`/`linkedMember`).
- Stage 07: 21 → 22 calls. The tap line moved from `callbacks.ts` to `approval-taps.ts`; new `notices/send-held.ts` line (F099) → `notice_skipped` with `kind: "send_held"`, `reason: "unknown_send_limit"`. `actor` values now include `"e2e-seed"`. The lint entry for tenancy includes its new `repo/`.
- Stage 08, 09: counts unchanged (18, 22). Stage 08 notes the F099 send-limit hold (no old-form line).
- Stage 10: count unchanged (29). `host-guard.ts` still puts the system code only in the message; F085's `HostNotAllowedError` path is out of scope.
- Stage 11: 27 → 28: new `eval-judge.ts` retry line (F097) → `eval_judge_retry`. The eval stop line now prints `pool.stoppedReason`, a sentence from two constants: `eval_stopped` takes `reason` `error_streak` or `budget_cap`, never the text; new test 4.
- Stage 12: count unchanged (26); `retention.ts` gained the `captured` count → new number `captured_header_rows`; the synthetic scope text is now "test mail only".
- Stage 13: `no-console` count at the new base (0); D26 note. The `legacy_text` branch of the README `jq` line goes in stage 18.
- Stage 14: `main.ts` has no `main()` function (top-level code, F123 signal handlers): both guards install at top level after `setLogFormat`.
- Stage 17: 46 + 1 lines to change (was 32), no line list; `docs/known-alerts.md` now has one line.
- Stage 18: drop the `legacy_text` branch of the README `jq` line.
- Stage 19: shorter; same 13 steps.

## Facts checked, no change needed

- No landed ticket built a step of this plan: no `platform/cli.ts`, `telegramErrorFields`, kind lists, `test/log-capture.ts`, `deploy-logging.test.ts`, `deploy/logs.sh` or `docs/capabilities/logs.md` at `560e74e7`.
- `eslint.config.js`: same `logCall` selectors, the `warn` block and the F089 `error` block (`platform/**`, `main.ts`); F119 added only import-rule blocks for `auth-sso.ts`.
- `deploy/compose.yaml` and `deploy/check-logging.sh` unchanged since `0a5c2ee`; `check-logging.sh` reads `--profile '*'`.
- `platform/log-lint.test.ts` fixture is still `modules/mail/__log-fixture.ts`; the `web.ts` `[1]` case still exists.
- Test helpers exist: `createFakeMailProvider` and `failOn`, `createFakeMailSender`, `SmtpSendError`, `createFixedLlmClient`, `webTestApp`, `pauseOtherMailboxes`, `withRollback`, `runJobTick`; the five marker test files exist; every test file a stage names exists.
- Better Auth `generateId: "uuid"`; `terms_record_failed` in `platform/auth.ts`; `x-request-id` reuse as a lower-cased UUID.
- `modules/layers.json` gained `operator` and `privacy` (layer 5); they hold no old-form line. `borderZones()` fails on a module folder without a layer; stage 02 uses virtual fixture paths only.
- `bun.lock` changes (age-encryption, `@better-auth/sso`), new migrations, audit events, security-log kinds, the web account card and the e2e seed address blocks of F105/F106 do not touch this plan: F103 has no migration, no `bun.lock` change, no web key, no e2e test.
- The ticket's `Build after: F095` holds (F095 is in `done/`).

## Review

No cold review: no new or changed interface, schema, migration, step or stage order. D26 narrows one end check (forced by tested text); new table rows follow D5 and D16 as the plan foresaw.
