# s1b-shadow-triage — Stage 39

Part of [`../s1b-shadow-run.md`](../s1b-shadow-run.md) (moved from S1b on 2026-11-05; "this task file" means that file). "Input" and "Rules for every step" are in [`../../done/s1b-shadow-triage.md`](../../done/s1b-shadow-triage.md). Read them first.
Shell setup, preconditions and the SQL queries (Q1–QH) are in [`vps-shared.md`](vps-shared.md).

> **Change 2026-11-06 (user):** the window is 180 days, not 30 (only 32 real mails in 30 days). Read `30 days` below as `180 days` (`--days 180`, audit `--since <now − 180 days>`, QG/QH `interval '180 days'`). Second backfill run allowed for this change.

## Stage 39 — VPS: backfill of older INBOX mail [risky] (only when the week brought fewer than 100 real mails)

- [ ] **39.1 One-off backfill up to 30 days, re-queue, then label**
  - Goal: more real labels from older INBOX mail of the last 30 days (user decision 2026-11-04, answer 3; re-queue of stored `too_old` mail, answer Q29 (a)).
  - Files: this task file (log lines: QF before and after, audit output before and after, backfill output, QG, QH, QB).
  - Interfaces: none (operations).
  - Decisions: the backfill script runs `backfillMailbox` (stage 32) and then `requeueBackfillWindow` (stage 33) in one command. It is read-only on the mailbox and never moves the S1a cursor.
  - Steps:
    1. QF (cursor before): write `uidvalidity` and `last_uid`.
    2. Audit before: `$C run --rm -T server bun run mailbox:audit --org-id <ORG> --mailbox-id <MB> --since <now − 30 days, ISO>`. Write `missing` and `duplicates` (review finding 9).
    3. Write the start time `<BF_START>` (UTC). Run `$C run --rm -T server bun run mailbox:backfill --org-id <ORG> --mailbox-id <MB> --days 30` → `stored n`, `re-queued m`. "cursor moved" → run the same command again.
    4. QF again (review finding 8): `uidvalidity` is equal to step 1, and `last_uid` ≥ the step 1 value.
    5. Audit after: the same command as step 2 → `missing=0`, and `duplicates` not higher than in step 2.
    6. Wait until QG shows no `pending` or `processing` row (the cap allows about 300 calls per Los Angeles day).
    7. The user labels the new real mail with `triage:label` (as in step 38.1).
    8. QH and QB. Still under 100 labels → accept the labels that exist (user decision 2026-11-04). Write the count and "all real pilot INBOX mail of the last 30 days" in the log only when QH shows only `triaged` rows with `labeled = t` (`skipped` rows are allowed only for synthetic mail, which QH leaves out).
  - Test: none (operations).
  - Check: QF as in step 4; audit as in step 5; QG has only `triaged` rows and `min(received_at)` ≥ `<BF_START>` − 30 days (review finding 10); QH and QB in the log.
  - Done when: the checks pass and the label count is in the log.
  - Out of scope: more than 30 days back, other folders, any mailbox write, a second backfill (except after "cursor moved").
