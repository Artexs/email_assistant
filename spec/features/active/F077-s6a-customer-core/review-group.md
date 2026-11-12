# F077 group review (stage 18.1): stages 1–17

Reviewer: fresh-eyes Limen review job `2026-11-12-f077-group-review-ce9948ab` (Opus 5.5).
Scope: `1215ad5..b67fba3` (`git rev-parse HEAD` = `b67fba309f4c100dc1548dd9c0196a50a623ea4d`, clean tree). The commits for F049, F059, F069, F070 and F080 were checked only for conflicts with F077. The commits for F082 (`2e7d800`, `69f483f`, `b67fba3`) change plan files only (`spec/`, `tasks/`). They are outside the task list, and they do not touch code.

Result: no blocker and no major finding. Four minor findings and four notes. Each minor finding is an edge case of the retention rules or a gap in test evidence. None breaks a "Done when" bullet.

## Checks run (own DB `email_assistant_2026_11_12_ce9948ab`, after `bun install --frozen-lockfile`: "no changes", exit 0)

| Command                                                                                                                                                | Result                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `bun run lint`                                                                                                                                         | exit 0 (only the "multiple projects" notice from typescript-eslint)                             |
| `bun run typecheck`                                                                                                                                    | exit 0 (`@ea/web` 0 errors, `@ea/server` exit 0)                                                |
| `bun run test:unit`                                                                                                                                    | exit 0: 1753 pass, 0 fail, 134 files                                                            |
| `bun run test:int`, `bun run test:e2e`                                                                                                                 | not run, as the task says (the coordinator runs them)                                           |
| `grep -rln "TEST_MAILBOX_ADDRESS\|testMailboxAddress"` in `apps/server/src/{modules,platform,main,composition,web}.ts`, `packages/core/src` (no tests) | only `mail/imap/probe-move.ts`, `mail/tools.ts`, `platform/config.ts`: Done-when bullet 1 holds |

## 1. Pre-mortem: mail reached the LLM, a mailbox changed or a mail went out while the organization was `suspended` or the mailbox in `shadow`

No stage let it through. I traced every entry point:

- **LLM.** The only production caller of `llm.classify` is `triage/classifier.ts:42`, through the `triage.worker` job. The gate is `listSyncTargets` (`triage/jobs.ts:56` → `mail/repo.ts:910`, inner join with `plan <> 'suspended'`). There is also a per-mailbox re-check, `isOrgSuspended` (`triage/jobs.ts:67`), which runs before `claimEmails`. `scripts/eval.ts --real` reads only stored labels (`eval.ts:115-142`), and `llm-check.ts` sends a fixed greeting. Tests: `triage-job.test.ts` "a suspended organization gets no claim, no prompt and no llm.call row" and "a suspend during the run stops the next mailbox of the run".
- **Mailbox change and SMTP send.** Only the committer opens IMAP or SMTP for an action (`composition.ts:56-57` → `actions/committer.ts`). Its gate is `listSyncTargets` plus the re-check at `committer.ts:383-388`. The expiry job runs for suspended organizations (`expiry.ts:197-200`, `includeSuspended: true`), but it only writes DB rows: an `expired` status, or a reverse row that the gated committer applies later. The 48 h rule is `claimableWhere` (`actions/repo.ts:410`). Tests: `actions-committer.test.ts` "mailbox changes and sends of a suspended organization wait…" and `actions-expiry.test.ts` "(12) the expiry runs for a suspended organization; a resume does not send an approval older than 48 h".
- **Telegram messages to the customer.** The detection and the digest use `listLinkedChats(…, { includeSuspended: false })` (`notices.ts:731`, `digest-job.ts:73`). The sender uses the `NOT EXISTS` filter in `claimDueOutbox` (`channels/repo.ts:302-310`). Tests: `channels-notices.test.ts:112`, `channels-digest-job.test.ts:99`, `channels-sender.test.ts:146`.
- **Shadow.** Under scope `all`, the consent is the mode. The policy writes `logged` rows in `shadow`. A switch to `shadow` expires the open `move`, `mark_read` and `flag` rows and the sends (`config/service.ts:72`). A ready draft closes with its send (`expiry.ts:69-75` → `closeDraftOfSend`). The chaser requires `assist` and `create_draft` (`delegation/chaser.ts:210`). Tests: `scope-two-orgs.test.ts` "shadow: no mailbox-changing action leaves logged", "assist with auto off…", "assist with auto on…", and `delegation-chaser.test.ts` "(8) shadow mode or the switch off".
- **Operator CLIs.** `mailbox:backfill` refuses a suspended organization (F080, `scripts/mailbox-backfill-gate.ts`). `job:run` builds the same gated jobs (`scripts/job-run.ts:35-48`).

## 2. Jobs in `main.ts` against the stage 6 table

All 11 scheduled jobs have a row, and each gate is in the code:

| Job (`main.ts` line)       | Gate in code                                                                                                                                         | Suspended |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `mail.sync` (77)           | `listSyncTargets` + re-check `mail/jobs.ts:63,68`                                                                                                    | skipped   |
| `platform.heartbeat` (78)  | no organization                                                                                                                                      | —         |
| `channels.operator` (110)  | `listOrganizations`; `trial_ending` only for `plan = 'trial'` (`operator.ts:115`); `auth_error_24h` joins `plan <> 'suspended'` (`mail/repo.ts:902`) | skipped   |
| `triage.worker` (145)      | `listSyncTargets` + re-check `triage/jobs.ts:56,67`                                                                                                  | skipped   |
| `actions.committer` (162)  | `listSyncTargets` + re-check `committer.ts:383,388`                                                                                                  | skipped   |
| `actions.expiry` (167)     | `listMailboxTargets` with `includeSuspended: true` (`expiry.ts:197`)                                                                                 | runs      |
| `delegation.chaser` (173)  | `listSyncTargets` (`chaser.ts:204`)                                                                                                                  | skipped   |
| `triage.returned` (179)    | `listSyncTargets` (`returned.ts:83`)                                                                                                                 | skipped   |
| `platform.retention` (187) | `listOrganizations` (`retention.ts:106`), all plans                                                                                                  | runs      |
| `channels.notifier` (220)  | `listLinkedChats` (`notices.ts:731`) + `claimDueOutbox`                                                                                              | skipped   |
| `channels.digest` (224)    | `listLinkedChats` (`digest-job.ts:73`)                                                                                                               | skipped   |

Every caller of `listMailboxTargets(` and `listLinkedChats(` in `apps/server/src` passes `includeSuspended`. The A3 start line is at `main.ts:80-91`.

## 3. Web write routes against the stage 8 gate; Telegram against stage 7

- **Web.** All 18 write routes (F4) are on the `api` router. `refuseSuspendedWrites` is mounted after `requireTenant` and before the routers (`platform/http.ts:312-315`). No write route is mounted outside `api`, except the Better Auth allow-list. The `GET` routes write nothing: I read `channels/routes.ts:24`, `tenancy/routes.ts:36,67` and `config/routes.ts:85,176`. Test: `web-suspended.test.ts` "every write route answers org_suspended". It builds the route list from `app.routes` and compares it with the 18 routes written out at lines 30-47.
- **Telegram.** `createUpdateHandlers` (`channels/commands.ts:271-296`) checks `isOrgSuspended` before every command except `/help` and before every tap. Every command and every `callback_query:data` in `telegram/bot.ts:100-142` goes through these handlers. `/start` linking and the plain-message help reply are not gated, as A14 says. They change no mail and no LLM state. Tests: `channels-commands.test.ts:559` and `channels-callbacks.test.ts:1021,1042,1054`.

## 4. A §7 text that can stay longer than its period

The plain cases hold. No clear function filters on the mailbox status, the plan or the scope (`mail/repo.ts:1159-1240`, `actions/repo.ts:1647-1700`, `delegation/repo.ts:514-545`, `channels/repo.ts:488-540`). A ready draft in a paused mailbox closes with its send through the expiry job, which runs for all statuses and plans.

- **minor-1 (plausible, no test): a stuck `processing` mail body, or a stuck `applying` payload, stays without a time limit in a paused mailbox, in a suspended organization, or under `TRIAGE_LLM_SCOPE=off`.**
  - Evidence: `clearMailBodies` always keeps `status = 'processing'` (`mail/repo.ts:1180`). Only `claimEmails` takes back a stale `processing` row (`mail/repo.ts:966`), and only the triage worker calls it, for `listSyncTargets` mailboxes. With scope `off`, `main.ts` does not schedule the worker. So after a crash in the middle of a triage, the mail stays `processing` if the mailbox is then paused, the organization suspended, or triage switched off. Its body then stays past `data_retention_days`. The same holds for an `applying` `create_draft` or `send` payload: only the committer recovers it (M9), and `clearActionPayloads` clears closed statuses only (`actions/repo.ts:1643`).
  - Fix: in `clearMailBodies`, treat a `processing` row as clearable when `locked_at < before` (a stale lock far older than any triage run). In `clearActionPayloads`, also clear `applying` rows older than the period. Add one test for each.

## 5. A log line, error text, audit row or operator text with an address, a name or mail text

I found none in the diff. The new lines hold ids, codes, counts and ISO dates only. Examples: `main.ts:86-88`; `commands.ts:275,282`; `operator.ts:54,118-121,135`; `retention.ts:93-95,111,116`; `tenancy/service.ts:209` (the actor is `"cli"`, `org-plan.ts:55`); `org-status-lines.ts:47-51`; `mailbox-backfill-gate.ts:10`; the `org.plan_changed` audit data (`from`, `to`, `max_*`, `trial_ends_at`); the `operator.notice` audit data `{ kind, key }`. Errors go through `describeError` or `telegramErrorLabel`. Test: `retention-job.test.ts` "the lines hold counts and the organization id; no subject, address or body text". The paused Telegram text and `/api/me` hold `OPERATOR_CONTACT`. That is the operator's public contact (D29), not customer data.

## 6. A retention rule that clears open work

`awaiting_approval`, `approved`, `ready` drafts and `ready` sends keep their payload (`actions/repo.ts:1642-1673`). `pending` and `sending` outbox rows are ended only after 90 days. That is past the 24 h sender rule, so they are dead already.

- **minor-2 (plausible, no test): an open delegation whose due date is more than 90 days after its last change loses its task text before its reminders.**
  - Evidence: `clearDelegationTasks` clears by `updated_at < now − 90 d`, with no status filter (`delegation/repo.ts:533`). The due date has no upper bound (`packages/core/src/triage/payloads.ts:12`). A `sent` delegation changes only at `overdue` (`repo.ts:313`). So a delegation that is due on day 120 has `task_summary = '[removed]'` from day 90. Its reminder draft then writes the task `[removed]` (`chaser.ts:146`). It also loses the due date and the language, because the applied original draft's payload was cleared at 90 days (`chaser.ts:138-140`, `clearActionPayloads` with `applied`). The owner still sees the draft before the send tap, so nothing goes out unseen. §7 documents "90 days after its last change", so the code follows the doc. The gap is in the rule.
  - Fix: clear `task_summary` only for `done`, `cancelled` and `answered` delegations, and for `overdue` delegations with `reminders_sent >= MAX_REMINDERS`, or use `greatest(updated_at, due_at)`. Keep the original draft payload while its delegation is open. Alternatively, the chaser skips a reminder when the task is `[removed]`. Update the §7 row to match.
- **minor-3 (plausible, no test): a `pending` backfilled mail loses its body and is then triaged without it.**
  - Evidence: `clearMailBodies` clears a `pending` body after `max(data_retention_days, 7 d)` from `created_at` (`mail/repo.ts:1179-1181`). The `too_old` and `suspended_backlog` rules exempt backfilled mail (`triage/service.ts:403,409`). So a backfilled mail that waits in `pending` for more than 30 days (organization suspended, or triage `off`) goes to the LLM later with `bodyText: null` (`service.ts:463`). The result is a poor classification. A23 accepts the 7-day rule only for mail that the age rule ends anyway.
  - Fix: in `triageOne`, a `pending` mail with `body_text IS NULL` and `backfilled_at IS NOT NULL` becomes `skipped` with a new reason code (for example `body_expired`), with no LLM call.

## 7. Migrations `org_plan`, `retention_indexes`, `smtp_security`

These are safe on the pilot rows, and their order does not matter.

- `20261112100001_org_plan.sql`: every new column is nullable or has a default (`plan` = `'active'`, `max_mailboxes` = 2), so every existing row passes `organizations_trial_end_check`. The default `active` instead of D3's `trial` is decision A6, accepted by the user. The default privileges (`app_grants.sql:2`) give `app` the new columns. No column-level grants exist.
- `20261112100002_retention_indexes.sql`: three new index names. No earlier migration uses them (grep).
- `20261112110001_smtp_security.sql` (F049): default `'tls'` is the old transport behaviour (`git show 1215ad5:…/smtp.ts:25`, implicit TLS unless loopback). So the pilot mailbox keeps working.
- Order: the three touch different tables (`organizations`; `outbox` and `emails`; `mailboxes`), and none reads another's object. dbmate applies every pending version, so the order does not matter. A rollback to the S5 code also stays safe: old inserts fill every new `NOT NULL` column from its default.

## Other findings and notes

- **minor-4 (evidence gap, proven by reading the tests): the retention "Done when" bullet asks for "one test per row … also for a paused mailbox, a suspended organization and under `TRIAGE_LLM_SCOPE=off`".** Only the mail-body row has the paused or suspended test (`retention-clear.test.ts:95`, `retention-job.test.ts:83`). No test names scope `off`. The code has no status, plan or scope filter in any clear function (§4 above), so the behaviour holds. Only the test evidence is narrower than the bullet. Fix: add one combined test that seeds every §7 row in a paused mailbox of a suspended organization and asserts the cleared values. Then name in the bullet that the job reads no scope.
- **Note (F049 × F077, no conflict):** `connectMailbox` keeps the stage 10 lock and count (`mail/connect.ts:140,170-174`) and passes `smtpSecurity` into the insert inside the lock (`connect.ts:182`). The password change reads `mailbox.smtp_security` (`connect.ts:240`). I found no conflict with F059 (Better Auth paths stay outside the `api` gate), F069 (Compose subnet), F070 (rule files) or F080 (it uses `isOrgSuspended`).
- **Note (ticket drift, not repaired):** `ticket.md` § "Progress and how to continue" still says that stages 1–10 are landed and stage 11 is running. The `plan.md` status line says "Left: stages 6–18". Stage 18.1 names the record path `tasks/active/s6a-customer-core/review-group.md`, and this task uses `spec/features/active/F077-…/review-group.md`. Stage 18.4 says "the two S6a migrations". There are three new migrations now (with F049's `smtp_security`). All three are backward-compatible, so the rollback rule still holds.
- **Note (design, not a finding):** in `suspended`, an owner cannot remove a mailbox (`DELETE /api/mailboxes/:id` → 403), and the trial end does not suspend an organization automatically. Both follow S2 and D3.

VERDICT: PASS
