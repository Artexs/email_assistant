> **Status 2026-11-09 — planned.** Not started. Build it only if the spam folder load grows (decision D14: no separate limit now).

# A separate daily LLM limit for spam folder mail

Scope: follow-up of [`../../done/2026-11/F058-sync-sort-folders/plan.md`](../../done/2026-11/F058-sync-sort-folders/plan.md) (D14, U8, F4). Needs: that task done.

## Goal

Mail from the spam folder (`Wiadomości-śmieci`) uses the shared daily LLM cap (`LLM_DAILY_CAP`, default 300). The count on 2026-11-08 showed 3 spam folder mails in 8 days, so D14 added no separate limit. If a spam wave ever uses the cap, add one so that spam folder mail cannot starve the other mail.

## Done when

- A count of `llm.call` rows for mail with `source_folder` = the `junk` path per quota day is compared with a limit (start value 100, from user decision U8).
- Over the limit, spam folder mail waits for the next quota day with one warning per mailbox and day. Other mail keeps its own cap.
- A unit or integration test covers the limit and the wait. The wait message is in `docs/known-alerts.md`.

## Plan

Write the file-level plan when the task starts. Use the same place as the existing daily cap (`apps/server/src/modules/triage/jobs.ts`).

- [ ] Write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-09: Created from the follow-ups of `sync-sort-folders` (stage 15, step 15.2).
