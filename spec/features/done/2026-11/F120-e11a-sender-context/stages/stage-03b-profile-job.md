# F120 stage 03b — Profile job, lock, flags [risky]

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). Decisions P1, D8, D16.

Carry-over reads: stage 03 code; `apps/server/src/main.ts` (scheduling of `loops.match`), `apps/server/src/scripts/job-run*` (`job:run` names), `platform/log-fields.ts`, `docs/capabilities/sent-mail.md` (switch, `first_pass_at`), `packages/core/src/features.ts`.

## Step 1 — the job

- Job `contacts.refresh` (`0 7 * * * *`): each active mailbox of each organization that is not suspended and has `sender_context` on. It needs no LLM, so it runs whatever `TRIAGE_LLM_SCOPE` says. A mailbox error logs `contacts_refresh_mailbox_failed` (`mailbox_id`, error code) and the run goes on.
- `bun run job:run --name contacts.refresh` runs one pass and prints counts only.
- Log `contacts_refresh_done` (`mailbox_id`, `count` = written, `zeroed`, `duration_ms`); fields in `platform/log-fields.ts`. No address, hash or subject.
- Flag rule (P1): a helper `senderFlags(db, ctx)` returns `{ context, suggestions, contactWait }` where the last two are true only when `sender_context` is also on. Stages 05, 06, 09 use it.
- `sentCoverage(db, ctx, mailboxId)` (D16): true when the flag `sent_sync` is on, the mailbox switch is on and `first_pass_at` is set. Stage 05 passes it to `suggestionsFor`.

## Step 2 — time limit

- A seeded mailbox of 5,000 mails from 500 senders, 2,000 Sent mails, flags and feedback: one pass finishes in ≤ 15 s in the integration test (CI bound; the VPS bound is stage 13). The worker reports the measured time.
- If the bound fails, the worker stops and reports the plan of the slow statement (`EXPLAIN`); an index needs a migration and is a question (stage 02 owns the only migration).

## Test (integration `contacts-refresh-job.test.ts`)

1. Flag off → the job writes nothing for that org; a suspended org → nothing; the other org gets rows.
2. Two passes at once on two connections (the first holds the lock in an open transaction) → the second returns `skipped: true`; after both, one row per address.
3. `senderFlags`: `sender_context` off, `sender_suggestions` on → `suggestions` false; both on → true.
4. `sentCoverage`: flag off → false; switch off → false; `first_pass_at` null → false; all set → true.
5. A failing mailbox (fake error from the read) → `contacts_refresh_mailbox_failed` once; the next mailbox still gets rows.
6. The time bound of step 2.
7. Log lines hold no `@` character (capture the log lines in the test).

## Done when

All tests pass; mutation: remove the try-lock → test 2 fails. Then the Proof command.

## Carry-over from the stage 03 review (2026-11-18)
See `../review-3.md`: write only changed rows on a repeat pass (no 5300 dead tuples per hour per mailbox) and test it; the time test uses committed data plus `ANALYZE` by the migrator role; the job gates suspended organizations and paused mailboxes.
