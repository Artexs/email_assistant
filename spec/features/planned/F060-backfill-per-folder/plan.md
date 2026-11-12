> **Status 2026-11-09 — planned.** Not started. Build it only if the user wants old mail of a synced folder in the system.

# `mailbox:backfill --folder`

Scope: follow-up of [`../../done/2026-11/F058-sync-sort-folders/plan.md`](../../done/2026-11/F058-sync-sort-folders/plan.md) (D16: `mailbox:backfill` stays INBOX-only). Needs: that task done.

## Goal

A new synced folder gets only a 24 hour first sync (U3). `mailbox:backfill` reads INBOX only. Add `--folder <key>` so that the operator can load older mail of `offers`, `social`, `bills` or `junk` once.

## Done when

- `bun run mailbox:backfill --folder offers` reads that folder from the given date, stores the mail with `source_folder` set, and does not move the folder cursor.
- A key of a disabled or unknown folder ends with a clear error. No `--folder` keeps the INBOX behaviour.
- A test covers the folder option. The tool help and `deploy/README.md` name it.

## Plan

Write the file-level plan when the task starts. Use `backfillInbox` in `apps/server/src/modules/mail/sync.ts` and `apps/server/src/scripts/mailbox-backfill.ts`.

- [ ] Write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-09: Created from the follow-ups of `sync-sort-folders` (stage 15, step 15.2).
