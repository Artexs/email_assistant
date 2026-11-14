# Retention

> Checked against the code at `432b5e2`, 2026-11-14.

## What it does now

The system keeps mail text only for a limited time. Once a day the job `platform.retention` clears the stored texts of every organization: the mail body after the organization's `data_retention_days` (30 by default), and the subject, addresses, summaries, draft text, reasons, extracted fields, task text, error text and message text after 90 days. The rows stay, so counts and the audit trail keep working; only the text goes. The job runs for every organization of every plan, a `suspended` one too. It also deletes used or expired Telegram link tokens and expired reset and invite tokens. The job logs counts only. The periods and the table of what is kept are in `docs/architecture.md` §7 (retention table); this page does not copy it.

## Rules

1. **The job.** The retention job `platform.retention` runs daily at 02:40 (the backup runs at 03:30, `backups.md`). The scheduler never starts a tick while the last one runs. Shutdown waits for a running retention job. `run()` never throws: an error in one organization is logged (`retention org <id> failed: …`) and the run goes on with the next organization; a failure of the whole run is logged (`retention failed: …`).
2. **What each clear function does.** The period of a row is counted from the time the row was created (`created_at`), or from its last change (`updated_at`) where the table says so. The table and the period source are the rows of `docs/architecture.md` §7 (retention table).

   | Function                     | Clears                                                                                               | Period                                                       | Row of the §7 table                    |
   | ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
   | `clearMailBodies`            | `emails.body_text` → null                                                                            | `organizations.data_retention_days`; a `pending` mail 7 days | Mail body text                         |
   | `clearMailHeaders`           | `emails.subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header` | 90 days (`RETENTION_TEXT_DAYS`)                              | Subject, addresses                     |
   | `clearTriageTexts`           | `triage_results.reason` → null, `triage_results.fields` → `{}`                                       | 90 days                                                      | Summaries, draft text, reasons, fields |
   | `clearActionPayloads`        | `actions.payload` → `{}` of `save_summary`, `create_draft` and `send` rows (rule 4)                  | 90 days                                                      | Summaries, draft text, reasons, fields |
   | `clearActionErrors`          | `actions.last_error` → null                                                                          | 90 days after the last change                                | Error text                             |
   | `clearDelegationTasks`       | `delegations.task_summary` → `[removed]`, only for a delegation that is not open (rule 4)            | 90 days after the last change                                | Task text                              |
   | `clearOutboxTexts`           | `outbox.text` → `[removed]`, `outbox.view` → `{}` (rule 5)                                           | 90 days                                                      | Message text                           |
   | `deleteOldLinkTokens`        | deletes `chat_link_tokens` rows that were used or expired                                            | 1 day after use or expiry                                    | Old `chat_link_tokens` rows (job text) |
   | `deleteExpiredVerifications` | deletes `auth_verifications` rows (reset and invite tokens)                                          | 1 day after `expires_at`                                     | Reset and invite tokens                |

   The technical ids `message_id_header`, `dedup_key`, `thread_key` and `content_hash` stay: the sync finds mail by them. The job never touches `audit_log` or `triage_feedback` (ADR 0008: audit rows are kept until the mailbox or organization is removed).

3. **Pending and processing mail.** The body of a `processing` mail stays while its lock is younger than both the retention period and 7 days (the running triage reads it; an older lock is stuck), and the body of a `pending` mail goes only after 7 days (`PENDING_BODY_DAYS`). A backfilled `pending` mail that lost its body is `skipped` with `body_expired` (no LLM call).
4. **Actions and delegations.** The payload of an `applying` `create_draft` or `send` goes 90 days after its last change. Other open `create_draft` and `send` rows are not touched. The applied draft of an open delegation keeps its payload (the chaser reads its language and due date): `isOpenDelegationDraft` is the keep rule that the job passes to `clearActionPayloads`, so the `actions` module does not need to know it. A delegation is open while its status is `drafted` or `sent`, or `overdue` with a reminder left; the task text of an open delegation stays. A draft of a mail without a body quotes nothing, and "Send again" on a failed send without a payload answers `draft_gone`.
5. **Outbox.** A `sent` or `failed` row gets the text `[removed]` and an empty view (its `error_code` stays). A `pending` or `sending` row older than 90 days becomes `failed` / `expired` and loses its text and its view: the row of a suspended organization is never claimed, and a message of that age must not go out at a resume.
6. **Every organization, every plan.** The job walks `listOrganizations`, so a paused mailbox, a `suspended` organization and `TRIAGE_LLM_SCOPE=off` change nothing.
7. **Crash safety.** Each clear function works in batches of 1 000 rows, selected by id with `FOR UPDATE SKIP LOCKED`. There is no transaction around the whole run. A row that another job holds waits for the next day. Every rule excludes rows that are already cleared, so a run that stopped in the middle is safe to repeat and a second run changes nothing.
8. **The log.** Per organization one line `retention org <id>: body N, headers N, triage N, payloads N, errors N, tasks N, outbox N, tokens N`, written only when the sum is above 0, and one line `retention: <n> organizations, <m> rows` per run. The lines hold counts and the organization id only: no text and no mail id. The expired `auth_verifications` rows go once per run, not per organization; the log line `retention_auth_verifications_deleted` holds the count. A failure there (`retention_auth_verifications_failed`) never stops the run; the rows wait for the next day.

## Entry points

| Kind     | Name                                                       | Where                                               |
| -------- | ---------------------------------------------------------- | --------------------------------------------------- |
| job      | `platform.retention` (`0 40 2 * * *`: daily at 02:40)      | `apps/server/src/main.ts`                           |
| function | `createRetentionJob`, `RETENTION_TEXT_DAYS`                | `apps/server/src/retention.ts`                      |
| function | `clearMailBodies`, `clearMailHeaders`, `PENDING_BODY_DAYS` | `apps/server/src/modules/mail/repo/retention.ts`    |
| function | `clearTriageTexts`                                         | `apps/server/src/modules/triage/repo.ts`            |
| function | `clearActionPayloads`, `clearActionErrors`                 | `apps/server/src/modules/actions/repo/retention.ts` |
| function | `clearDelegationTasks`, `isOpenDelegationDraft`            | `apps/server/src/modules/delegation/repo.ts`        |
| function | `clearOutboxTexts`, `deleteOldLinkTokens`                  | `apps/server/src/modules/channels/repo.ts`          |
| function | `deleteExpiredVerifications`                               | `apps/server/src/platform/auth.ts`                  |
| function | `listOrganizations`                                        | `apps/server/src/modules/tenancy/repo.ts`           |

## Data

The job writes these columns and no others: `emails` (`body_text`, `subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header`), `triage_results` (`reason`, `fields`), `actions` (`payload`, `last_error`), `delegations` (`task_summary`), `outbox` (`text`, `view`, and `status` / `error_code` of an old unsent row), `chat_link_tokens` and `auth_verifications` (rows deleted). `organizations.data_retention_days` (default 30, at least 1) is the only period that an organization can differ in; the web shows it (`retentionDays` in the organization view), but no route and no CLI changes it.

## Limits

- No delete of an organization's data and no export: E7-T3 (F106).
- No data-subject erase of a sender who is not a user (`org:dsr`): E7-T3 (F106, PD-038).
- No route or CLI changes `data_retention_days`; the value changes only in the database.
- No alert when the job fails or does not run. The log line is the only sign.

## Decisions

- ADR 0008 (the audit rows are kept).
- PD-038 (Limits only: data-subject requests).

## Tests

- `apps/server/test/integration/retention-job.test.ts`
- `apps/server/test/integration/retention-clear.test.ts`
