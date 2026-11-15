# Retention

> Checked against the code at `d331192b`, 2026-11-15.

## What it does now

The system keeps mail text only for a limited time. Once a day the job `platform.retention` clears the stored texts of every organization: the mail body and the stored text of sent mail after the organization's `data_retention_days` (30 by default), and the subject, addresses, summaries, draft text, reasons, extracted fields, task text, error text and message text after 90 days. The rows stay, so counts and the audit trail keep working; only the text goes. The job runs for every organization of every plan, a `suspended` one too. It also deletes used or expired Telegram link tokens, expired OAuth sign-in states and expired reset and invite tokens. The job logs counts only. The periods and the table of what is kept are in `docs/architecture.md` §7 (retention table); this page does not copy it.

## Rules

1. **The job.** The retention job `platform.retention` runs daily at 02:40 (the backup runs at 03:30, `backups.md`). The scheduler never starts a tick while the last one runs. Shutdown waits for a running retention job. `run()` never throws: an error in one organization is logged (`retention_org_failed`, fields `org_id`, `error`) and the run goes on with the next organization; a failure of the whole run is logged (`retention_failed`, field `error`).
2. **What each clear function does.** The period of a row is counted from the time the row was created (`created_at`), or from its last change (`updated_at`) where the table says so. The table and the period source are the rows of `docs/architecture.md` §7 (retention table).

   | Function                     | Clears                                                                                                                                                                                                                      | Period                                                            | Row of the §7 table                                   |
   | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
   | `clearMailBodies`            | `emails.body_text` → null                                                                                                                                                                                                   | `organizations.data_retention_days`; a `pending` mail 7 days      | Mail body text                                        |
   | `clearCapturedHeaders`       | `email_headers`: `from_name`, `return_path`, `auth_results`, `list_unsubscribe`, `list_id` → null, `reply_to` → `'{}'` (an empty array; the column is `NOT NULL`), `attachments` and `links` → `[]`, `texts_cleared_at` set | `organizations.data_retention_days`                               | Captured headers                                      |
   | `clearSentBodies`            | `sent_emails.body_text` → null; `content` stays `stored`                                                                                                                                                                    | `organizations.data_retention_days`, counted from `internal_date` | Sent mail text                                        |
   | `clearMailHeaders`           | `emails.subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header`                                                                                                                        | 90 days (`RETENTION_TEXT_DAYS`)                                   | Subject, addresses                                    |
   | `clearSentHeaders`           | `sent_emails.subject`, `from_address` → null; `to_addresses`, `cc_addresses`, `references_ids` → `'{}'`                                                                                                                     | 90 days, counted from `internal_date`                             | Sent mail subject, addresses                          |
   | `clearTriageTexts`           | `triage_results.reason` → null, `triage_results.fields` → `{}`                                                                                                                                                              | 90 days                                                           | Summaries, draft text, reasons, fields                |
   | `clearActionPayloads`        | `actions.payload` → `{}` of `save_summary`, `create_draft` and `send` rows (rule 4)                                                                                                                                         | 90 days                                                           | Summaries, draft text, reasons, fields                |
   | `clearActionErrors`          | `actions.last_error` → null                                                                                                                                                                                                 | 90 days after the last change                                     | Error text                                            |
   | `clearDelegationTasks`       | `delegations.task_summary` → `[removed]`, only for a delegation that is not open (rule 4)                                                                                                                                   | 90 days after the last change                                     | Task text                                             |
   | `clearOutboxTexts`           | `outbox.text` → `[removed]`, `outbox.view` → `{}` (rule 5)                                                                                                                                                                  | 90 days                                                           | Message text                                          |
   | `deleteOldLinkTokens`        | deletes `chat_link_tokens` rows that were used or expired                                                                                                                                                                   | 1 day after use or expiry                                         | Old `chat_link_tokens` rows (job text)                |
   | `deleteOldOAuthStates`       | deletes `mailbox_oauth_states` rows (OAuth sign-in state) that expired                                                                                                                                                      | 1 hour after expiry                                               | Old `mailbox_oauth_states` rows (counted in `tokens`) |
   | `deleteExpiredVerifications` | deletes `auth_verifications` rows (reset and invite tokens)                                                                                                                                                                 | 1 day after `expires_at`                                          | Reset and invite tokens                               |

   The technical ids `message_id_header`, `dedup_key`, `thread_key` and `content_hash` stay: the sync finds mail by them. The same holds for a sent row: `message_id`, `parent_message_id`, `thread_key`, `dedup_key`, `origin`, `content` and the times stay, so `listUserAnswers` still answers after the headers are cleared. A sent row counts from the date of the mail in Sent (`internal_date`), not from the time the system stored it: the first pass stores mail up to 30 days old. The job never touches `audit_log` or `triage_feedback` (ADR 0008: audit rows are kept until the mailbox or organization is removed).

3. **Pending and processing mail.** The body of a `processing` mail stays while its lock is younger than both the retention period and 7 days (the running triage reads it; an older lock is stuck), and the body of a `pending` mail goes only after 7 days (`PENDING_BODY_DAYS`). A backfilled `pending` mail that lost its body is `skipped` with `body_expired` (no LLM call).
4. **Actions and delegations.** The payload of an `applying` `create_draft` or `send` goes 90 days after its last change. Other open `create_draft` and `send` rows are not touched. The applied draft of an open delegation keeps its payload (the chaser reads its language and due date): `isOpenDelegationDraft` is the keep rule that the job passes to `clearActionPayloads`, so the `actions` module does not need to know it. A delegation is open while its status is `drafted` or `sent`, or `overdue` with a reminder left; the task text of an open delegation stays. A draft of a mail without a body quotes nothing, and "Send again" on a failed send without a payload answers `draft_gone`.
5. **Outbox.** A `sent` or `failed` row gets the text `[removed]` and an empty view (its `error_code` stays). A `pending` or `sending` row older than 90 days becomes `failed` / `expired` and loses its text and its view: the row of a suspended organization is never claimed, and a message of that age must not go out at a resume.
6. **Every organization, every plan.** The job walks `listOrganizations`, so a paused mailbox, a `suspended` organization and `TRIAGE_LLM_SCOPE=off` change nothing.
7. **Crash safety.** Most clear functions work in batches of 1 000 rows, selected by id with `FOR UPDATE SKIP LOCKED`. Two do not: `deleteExpiredVerifications` is one delete with no batch and no lock, and `deleteOldLinkTokens` selects by `token_hash`. There is no transaction around the whole run. A row that another job holds waits for the next day. Every rule excludes rows that are already cleared, so a run that stopped in the middle is safe to repeat and a second run changes nothing.
8. **The log.** Per organization one event `retention_org_done` with `org_id` and the counts `body_rows`, `header_rows`, `sent_body_rows`, `sent_header_rows`, `captured_header_rows`, `triage_rows`, `payload_rows`, `error_rows`, `task_rows`, `outbox_rows`, `token_rows` (`token_rows` adds the Telegram link tokens and the OAuth sign-in states), written only when the sum is above 0, and one event `retention_done` (`org_count`, `count`) per run. The lines hold counts and the organization id only: no text and no mail id. The expired `auth_verifications` rows go once per run, not per organization; the log line `retention_auth_verifications_deleted` holds the count. A failure there (`retention_auth_verifications_failed`) never stops the run; the rows wait for the next day.

9. **Data of F109 (suspicious-mail rules, attachment line, urgency profile, `not_triaged` notice).**
   - `triage_results.suspicious_reasons` holds reason codes only (a fixed list of six; a CHECK enforces it). It holds no text, so `clearTriageTexts` leaves it and the codes stay as long as the row.
   - `mailbox_settings.urgency_profile` (the owner's topics, keywords and deadlines) follows the settings row of the mailbox. No retention function clears it; it goes when the mailbox or the organization is deleted, and `org:export` lists it. A mail address typed in a topic stays in it (the privacy map says "open").
   - `emails.from_address_lower` is a generated copy of `from_address`. When `clearMailHeaders` clears the address, the database recomputes the copy, so it goes with it.
   - **Attachment names in a notice outlive the capture.** The urgent view (`outbox.view`) and the rendered `outbox.text` can hold up to 3 attachment names (cut to 40 characters, with type and size) while the flag `attachment_line` is on. `clearOutboxTexts` clears them after `RETENTION_TEXT_DAYS` (90 days), but `email_headers.attachments` goes after the `data_retention_days` of the organization (default 30, minimum 1). So these names can stay up to 90 days, longer than the captured list (30 days by default). The subject in the view lives as long.
   - A `not_triaged` row holds the sender address in `outbox.view` and `outbox.text`; `clearOutboxTexts` clears both after 90 days, and the erase of the mail removes the row (kind `one_mail`).

## Entry points

| Kind     | Name                                                       | Where                                               |
| -------- | ---------------------------------------------------------- | --------------------------------------------------- |
| job      | `platform.retention` (`0 40 2 * * *`: daily at 02:40)      | `apps/server/src/main.ts`                           |
| function | `createRetentionJob`, `RETENTION_TEXT_DAYS`                | `apps/server/src/retention.ts`                      |
| function | `clearMailBodies`, `clearMailHeaders`, `PENDING_BODY_DAYS` | `apps/server/src/modules/mail/repo/retention.ts`    |
| function | `clearSentBodies`, `clearSentHeaders`                      | `apps/server/src/modules/mail/repo/retention.ts`    |
| function | `clearCapturedHeaders`                                     | `apps/server/src/modules/mail/repo/headers.ts`      |
| function | `clearTriageTexts`                                         | `apps/server/src/modules/triage/repo.ts`            |
| function | `clearActionPayloads`, `clearActionErrors`                 | `apps/server/src/modules/actions/repo/retention.ts` |
| function | `clearDelegationTasks`, `isOpenDelegationDraft`            | `apps/server/src/modules/delegation/repo.ts`        |
| function | `clearOutboxTexts`, `deleteOldLinkTokens`                  | `apps/server/src/modules/channels/repo.ts`          |
| function | `deleteOldOAuthStates`                                     | `apps/server/src/modules/mail/repo/retention.ts`    |
| function | `deleteExpiredVerifications`                               | `apps/server/src/platform/auth.ts`                  |
| function | `listOrganizations`                                        | `apps/server/src/modules/tenancy/repo/index.ts`     |

## Data

The job writes these columns and no others: `emails` (`body_text`, `subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header`), `sent_emails` (`body_text`, `subject`, `from_address`, `to_addresses`, `cc_addresses`, `references_ids`, `updated_at`), `email_headers` (`from_name`, `reply_to`, `return_path`, `auth_results`, `list_unsubscribe`, `list_id`, `attachments`, `links`, `texts_cleared_at`), `triage_results` (`reason`, `fields`), `actions` (`payload`, `last_error`), `delegations` (`task_summary`), `outbox` (`text`, `view`, and `status` / `error_code` of an old unsent row), `chat_link_tokens` and `auth_verifications` (rows deleted). `organizations.data_retention_days` (default 30, at least 1) is the only period that an organization can differ in; the web shows it (`retentionDays` in the organization view), but no route and no CLI changes it.

## Limits

- Retention does not delete rows or a person's data on request. The delete of an organization, the export and the erase of a sender's data (`org:delete`, `org:export`, `org:dsr`) are in [account-data.md](account-data.md) (F106). A restore of a backup brings back rows that a delete or an erase removed after the backup; the operator runs them again (`account-data.md` rule 15).
- Retention is not the erase: it clears texts by age and keeps the rows. A tombstone (`dsr_tombstones`) has no expiry and no retention job clears it.
- No route or CLI changes `data_retention_days`; the value changes only in the database.
- No alert when the job fails or does not run. The log line is the only sign.
- A cut attachment name in a notice stays up to 90 days, longer than the captured list when `data_retention_days` is below 90 (rule 9).

## Decisions

- ADR 0008 (the audit rows are kept).
- PD-038 (Limits only: data-subject requests).

## Tests

- `apps/server/test/integration/retention-job.test.ts`
- `apps/server/test/integration/retention-clear.test.ts`
- `apps/server/test/integration/retention-clear-sent-concurrent.test.ts`
