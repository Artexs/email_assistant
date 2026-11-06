> **Status 2026-11-06 — planned.** Found in S2 (stage 22): the daily retention job does not exist yet.

# Retention job (`platform.retention`)

Scope: `docs/architecture.md` §7 (retention table) and §8 (scheduler: "retention cleanup daily"); `docs/modules.md` §3.0 (`retention` job). Needs: S2 (the `outbox` table).

## Goal

A daily job in the server process clears text columns after their retention time, so stored mail text and message text do not stay longer than the documented time.
Today no job runs: `emails.body_text`, the digest and notice texts in `outbox.text` and the other rows in the table below stay for ever.

## Done when

- The job `platform.retention` runs daily in `main.ts` (scheduler `croner`, one tick never overlaps the next) and logs counts only (no mail text, no ids of mail).
- It clears (sets to `NULL` or an empty value that the schema allows; the plan decides per column):
  - `emails.body_text` after 30 days (`organizations.data_retention_days`).
  - `emails` subject and addresses after 90 days (the row stays for counts).
  - `actions.payload` (summaries, draft text), `triage_results.reason` and `triage_results.fields` after 90 days.
  - `actions.last_error` after 90 days.
  - `delegations.task_summary` 90 days after the delegation is `done`, or 90 days after its last change (S4; skip until the table exists).
  - `outbox.text` after 90 days (S2). The column is `NOT NULL` with a length check from 1: the plan decides between deleting old `sent` and `failed` rows and a migration that allows an empty text.
  - Old `chat_link_tokens` rows (used or expired for more than a short time, for example 1 day).
- `audit_log` and `triage_feedback` are not touched (kept until the mailbox or organization is removed).
- Tests with fixed dates: a row at the limit stays, a row over the limit is cleared, a row of another organization follows its own `data_retention_days`.
- `docs/architecture.md` §7 says that the job exists; the note in the `outbox.text` row about the follow-up is removed.

## Plan

Written when the task starts. Known input:

- **Checkpoint 2 decision (user, 2026-11-06):** the migration of this job adds these indexes, so the cascade deletes of `emails` and `digests` do not scan the whole `outbox`:
  - `CREATE INDEX outbox_email_idx ON outbox (email_id) WHERE email_id IS NOT NULL;`
  - `CREATE INDEX outbox_digest_idx ON outbox (digest_id) WHERE digest_id IS NOT NULL;`
    Add them in a new migration (never edit an applied one) and run `bun run db:types`.
- The job reads all organizations (an entry point without a `TenantContext`, like `listSyncTargets`): list it in `docs/code-patterns.md`.
- Deleting an outbox row of a `digest` kind leaves the `digests` row (slot key, period, `sent_at`); it keeps no text.

- [ ] step

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-06: Created in S2 stage 22. The user decided the two outbox indexes at S2 checkpoint 2.
