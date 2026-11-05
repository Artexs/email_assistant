# s1b-shadow-triage — Stage 33

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 33 — Re-queue `too_old` mail in the backfill window [risky]

- [ ] **33.1 `requeueTooOld` (mail) and `requeueBackfillWindow` (triage), called by the backfill script**
  - Goal: the backfill also gives the 7-day waiver to stored real INBOX mail of the window that the worker skipped as `too_old` (user answer Q29: (a)).
  - Files: change `apps/server/src/modules/mail/repo.ts` (`requeueTooOld`), `apps/server/src/modules/mail/index.ts` (export); change `apps/server/src/modules/audit/repo.ts` and `audit/index.ts` (`auditEvents.emailRequeued = "email.requeued"`); create `apps/server/src/modules/triage/backfill.ts` (`requeueBackfillWindow`), export from `triage/index.ts`; change `apps/server/src/scripts/mailbox-backfill.ts` (calls `requeueBackfillWindow` after `backfillMailbox`, prints `re-queued n`); create `apps/server/test/integration/triage-requeue.test.ts`.
  - Interfaces:
    - `requeueTooOld(trx: Transaction<DB>, ctx, mailboxId, opts: { since: Date; now: Date }): Promise<string[]>` (mail repo, no audit) — one conditional update: `UPDATE emails SET status = 'pending', skip_reason = NULL, next_attempt_at = NULL, backfilled_at = $now WHERE org_id = $org AND mailbox_id = $mb AND folder = 'INBOX' AND status = 'skipped' AND skip_reason = 'too_old' AND received_at >= $since AND (message_id_header IS NULL OR message_id_header NOT ILIKE SYNTHETIC_MESSAGE_ID_LIKE) RETURNING id`.
    - `requeueBackfillWindow(db: Db | Transaction<DB>, ctx: TenantContext, mailboxId: string, opts: { since: Date; now: Date }): Promise<number>` (triage) — one transaction (S1a pattern for a caller transaction): `ids = await requeueTooOld(trx, …)`, then one `recordAudit(trx, ctx, { emailId: id, actor: "system", event: auditEvents.emailRequeued, reasonCode: "backfill", data: { mailbox_id }, at: opts.now })` per id; returns `ids.length`.
    - Script: `since` = the same `now − days × 24 h` as the backfill; output `re-queued n` through `log.info`. A `CursorMovedError` from the backfill exits 1 before the re-queue; the re-run does both.
  - Decisions:
    - Why: the S1a rescan on 2026-11-04 stored INBOX mail back to about 2026-10-28; at the first `all` start (≥ 2026-11-06) the worker skips the part older than 7 days. The backfill finds these mails already stored (dedup) and cannot store them again, so without this step it cannot reach "all real pilot INBOX mail of the last 30 days".
    - Only `skipped` / `too_old` rows. Never `triaged` or `done` rows (a known mail is never triaged again, architecture §4.4). Synthetic mail is not re-queued.
    - The status change and its audit rows go in one transaction (code-patterns), in the triage module (review finding 13): `mail` never imports `audit` or `triage` (modules §2 has no `mail → audit` edge); `triage → mail` exists and `triage → audit` comes with step 19.1. Step 35.1 adds `triage → audit` to the graph in `docs/modules.md` §2.
    - Stage 35 adds the flow `skipped → pending` (one-off backfill re-queue, user 2026-11-04) to architecture §4.6.
  - Test (`triage-requeue.test.ts`, `withRollback`, `insertTestEmail`): `requeueBackfillWindow` with `since` = now − 30 d: a real `skipped` / `too_old` row of − 10 d → `pending`, `skip_reason` NULL, `next_attempt_at` NULL, `backfilled_at` = now, one `email.requeued` audit row with `reason_code` `backfill`; a `skipped` / `too_old` row of − 40 d stays; a synthetic `too_old` row stays; a `triaged` row stays; another org's row stays; the return value is 1; a second call returns 0 and writes no audit row.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: other skip reasons, other statuses, a re-triage of known mail.

## Added at checkpoint 1 (group review, 2026-11-05)

- The real / synthetic SQL test exists in the mail repo (`claimEmails`, `listThreadContext`) and in `triage/repo.ts` (`mailFilter`). Before this stage writes a third copy, export one predicate helper from the mail module (it owns `SYNTHETIC_MESSAGE_ID_LIKE`) and use it in `mailFilter` and `requeueTooOld`.
