# F085 stage 02 — Migration, server status type, the notice kind `host_blocked` [risky]

Part of [`../plan.md`](../plan.md). Read its D1, D2, D7, D8, D17, D18, "Rules for every stage", and `docs/code-patterns.md` § Notices are facts and § Add a notice kind first. Needs stage 01 (`mailboxStatuses` with `host_blocked`, `renderHostBlockedNotice`, the texts).

`[risky]`: a migration (two CHECK lists) and a message to people. A review job checks it before the land. No other migration of any ticket may be in build while this stage runs. After the land the coordinator runs `bun run db:migrate` on the shared dev DB (plan.md step C1).

One step (the checklist "Add a notice kind", steps 1–5, plus the mailbox status in the same migration). About 260 changed lines.

After this stage the DB accepts `host_blocked`, the server parses it and the notifier queues the notice for a mailbox in that status. No code sets the status yet (stage 05); only tests do.

- [ ] **2.1 The status in the DB and the server, and the notice kind**
  - Goal: a mailbox row may hold `host_blocked`; every linked owner gets one `host_blocked` notice per episode of that status.
  - Files (the checklist order):
    - core: `packages/core/src/notices/kinds.ts` (`"host_blocked"` as the last entry, after `"weekly_report"` of F100 stage 16); `views.ts` (`hostBlockedView` after `weeklyReportView`, and the entry `host_blocked: hostBlockedView` last in `noticeViewSchemas`); `renderers.ts` (the last entry, after `weekly_report`; `telegram.full` calls `renderHostBlockedNotice(view, textsFor(opts.locale))` as the `auth_error` entry, line 79, does); `packages/core/src/notices/registry.test.ts` (one case for the new kind in `cases`, as the `auth_error` case near line 138; put it last, after the `weekly_report` case). When F098 stage 12 is in `master`, its check in that file wants the `pl` render of each case to differ from the `en` render: the D9 texts differ, so the new case passes it. If a later ticket added another kind first, keep its entries and add `host_blocked` after them.
    - migration: `db/migrations/<build day><HHMMSS>_mailbox_host_blocked.sql`, a timestamp later than the newest file in `db/migrations/` (at c16849f: `20261114140001_weekly_report_kind.sql` of F100 stage 16; check `ls db/migrations | tail -3` at your start: another ticket may have added a newer one). Then `bun run db:migrate` on your job DB and `bun run db:types` (no change expected: `status` and `kind` are `string`; commit any change it makes).
    - server: `apps/server/src/modules/mail/repo/mailboxes.ts` (lines 121–122): `MailboxStatus` and `mailboxStatusSchema` come from core (D2). `apps/server/src/modules/channels/repo.ts` (`cancelPendingOutbox`, line 457; its `kind` union `"auth_error" | "sync_stale" | "send_held"` at line 460): the union gains `"host_blocked"`. New file `apps/server/src/modules/channels/notices/host-blocked.ts`. `apps/server/src/modules/channels/notices/index.ts`: import it and list `hostBlockedDetector` right after `authErrorDetector` in `detectors` (line 29); `queuedBy` (lines 39–43, with `weekly_report` of F100 stage 16) does not change. F100 stage 17 adds a detector to the same file: on a land conflict keep both.
    - tests: `apps/server/test/integration/channels-notices.test.ts` (a new `describe("host_blocked notices")` after the `auth_error notices` describe, line 264), `apps/server/test/integration/telegram-schema.test.ts` (the `mailbox_id` check), `apps/server/test/integration/mail-repo.test.ts` (the mailbox CHECK list). `apps/server/src/modules/channels/notices/registry.test.ts` and the "the CHECK lists match the lists of core" test (`telegram-schema.test.ts:396`) must pass unchanged.
  - Interfaces:

    ```ts
    // packages/core/src/notices/views.ts — strict, as the other views (`text`, `isoDate`, `timeZone` are the file's helpers)
    const hostBlockedView = z.strictObject({
      address: text, // the mailbox's own mail address, as in auth_error; never a host name (plan D8)
      since: isoDate, // mailboxes.status_changed_at
      now: isoDate,
      timeZone,
    });

    // apps/server/src/modules/mail/repo/mailboxes.ts
    import { mailboxStatuses, type MailboxStatus as CoreMailboxStatus } from "@ea/core";
    export type MailboxStatus = CoreMailboxStatus;
    export const mailboxStatusSchema = z.enum(mailboxStatuses);

    // apps/server/src/modules/channels/notices/host-blocked.ts — the shape of auth-error.ts
    export const hostBlockedDetector: Detector; // name "host-blocked", kinds ["host_blocked"]
    //   detect(run): for each mailbox of run.mailboxes:
    //     if mailbox.status !== "host_blocked": cancelPendingOutbox(run.db, run.ctx, { kind: "host_blocked", mailboxId }); continue
    //     key = `host_blocked:${mailbox.id}:${mailbox.status_changed_at.getTime()}`
    //     try: for each owner of run.owners: queue(run.db, run.ctx, { userId: owner.userId, locale: owner.locale,
    //            kind: "host_blocked", dedupKey: key, mailboxId: mailbox.id,
    //            view: { address: mailbox.address, since: mailbox.status_changed_at, now: run.now, timeZone: run.timeZone } }, run.now)
    //     catch: warnSkipped("host_blocked", mailbox.id, error)
    //     cancelPendingOutbox(run.db, run.ctx, { kind: "host_blocked", mailboxId: mailbox.id, exceptDedupKey: key })
    ```

    Migration. The kind list is the list on `master` at your start, plus `'host_blocked'`; it is never a fixed list from this plan. At c16849f the newest file that sets `outbox_kind_check` is `db/migrations/20261114140001_weekly_report_kind.sql` (F100 stage 16): the 12 kinds of `20261114100003_outbox_send_held.sql` plus `weekly_report`, 13 in all. The SQL below holds that list (the constraint name `mailboxes_status_check` is not verified, see (a)):

    ```sql
    -- migrate:up
    ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
    ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused', 'host_blocked'));
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report',
      'host_blocked'));
    -- A host_blocked row names its mailbox (as auth_error, sync_stale, sync_ok and send_held do).
    ALTER TABLE outbox ADD CONSTRAINT outbox_host_blocked_mailbox_check CHECK (kind <> 'host_blocked' OR mailbox_id IS NOT NULL);

    -- migrate:down
    -- Old code parses neither value: drop the notices, give the mailboxes back to the sync (it meets the guard again).
    DELETE FROM outbox WHERE kind = 'host_blocked';
    UPDATE mailboxes SET status = 'active', status_changed_at = now() WHERE status = 'host_blocked';
    ALTER TABLE outbox DROP CONSTRAINT outbox_host_blocked_mailbox_check;
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report'));
    ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
    ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused'));
    ```

    Before you write it:
    (a) Read the real name of the status CHECK on your job DB: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'mailboxes'::regclass and contype = 'c';` (use `psql "$DATABASE_URL"` of your job `.env`, or a one-off `bun -e` with the test DB helper; print only `conname` and the definition). Use that name in both parts. No migration after `20261103100001_mail.sql` changes that CHECK at c16849f; if one does at your start, take its list.
    (b) Read the current kind list two ways: the newest file that sets it (`grep -l outbox_kind_check db/migrations/*.sql | sort | tail -1`) and the live constraint on your job DB after `bun run db:migrate` (`select pg_get_constraintdef(oid) from pg_constraint where conname = 'outbox_kind_check';`). Both must equal `noticeKinds` of core without `host_blocked`. The `up` list is that list plus `'host_blocked'` last; the `down` list is that list exactly. If it differs from the 13 kinds above (another ticket added a kind), use the live list and name the extra kind in your final message.
    (c) Do not touch `outbox_send_held_mailbox_check` (of `20261114100003_outbox_send_held.sql`) or any other constraint of another kind.
    (d) Do not assume this file stays the last migration: a later ticket that adds a kind copies this file's list (it then holds `'host_blocked'`). The `down` part restores the list as it was before this file, so it is correct only while this file is the newest one; the rollback rule of `plan.md` D17 (roll back the code, not the migration) covers production.

  - Decisions: D1, D2, D7, D8, D17. The notice waits for the quiet hours like every non-digest notice. A suspended organization gets no notice (`listLinkedChats` skips it; the sender does not claim its rows).
  - Test (`channels-notices.test.ts` helpers `org`, `run`, `setStatus`, `rows`, `isolateChannels`; `T = 2026-11-06T10:00:00Z`; owner and assistant linked):
    1. `setStatus(trx, o, "host_blocked", at(-20 * MINUTE))`; `run` twice → exactly one `host_blocked` row, `user_id` = the owner, `dedup_key` = `host_blocked:<mailboxId>:<at(-20 min) ms>`, `mailbox_id` set, `status` `pending`; no row for the assistant.
    2. The row's `view` equals `{ address: <the mailbox address>, since: at(-20 min).toISOString(), now: T.toISOString(), timeZone: "Europe/Warsaw" }` and has no other key.
    3. `renderedOf(row)` → the text contains the mailbox address and none of `imap.x.test`, `smtp.x.test` (the fixture hosts) (D8).
    4. New episode: `setStatus(trx, o, "active")`, then `setStatus(trx, o, "host_blocked", at(-2 * MINUTE))`, `run` → two rows; the first is `failed` / `outdated`, the second `pending`.
    5. A pending row, then `setStatus(trx, o, "active")` and `run` → that row is `failed` / `outdated`; no new row.
    6. A `paused` mailbox and an `auth_error` mailbox → no `host_blocked` row (the `auth_error` one gets its own `auth_error` row as before).
    7. `telegram-schema.test.ts`: next to the line `await expectCode(trx, "held_no_mailbox", () => insert({ kind: "send_held", mailbox_id: null }), "23514");` (near line 282, the test's local `insert` helper), add `await expectCode(trx, "blocked_no_mailbox", () => insert({ kind: "host_blocked", mailbox_id: null }), "23514");`.
    8. `mail-repo.test.ts` (new test in the `mail repository: mailboxes` describe): the values of the mailbox status CHECK (`pg_get_constraintdef` of the constraint, the quoted words, sorted) equal `[...mailboxStatuses].sort()` from `@ea/core`; an update of a mailbox to `host_blocked` succeeds and `getMailboxSummary` returns `status: "host_blocked"`; an update to `frozen` fails with `23514`.
    9. The completeness tests pass: `apps/server/src/modules/channels/notices/registry.test.ts`, `packages/core/src/notices/registry.test.ts`, `telegram-schema.test.ts` "the CHECK lists match the lists of core".
  - Check: `bun run db:migrate`; `bun run db:types`; `ls db/migrations | tail -1` names your file (so the rollback below rolls back this file and no other); `bun test packages/core/src/notices packages/core/src/digest apps/server/src/modules/channels apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/telegram-schema.test.ts apps/server/test/integration/mail-repo.test.ts apps/server/test/integration/channels-sender.test.ts`; then `bun run db:rollback` and `bun run db:migrate` once more (the `down` part must run on your job DB); `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–9 pass; the rollback and the second migrate run without an error; `docs/architecture.md` §5 rows `mailboxes` (status list) and `outbox` (kind, dedup key `host_blocked:<mailbox id>:<status_changed_at ms>`) and the `channels` table of `docs/modules.md` §3.8 (`notices/` row: `host-blocked.ts`) name the change (checklist step 5; the full docs come in stage 07). Add only `host_blocked` there: if the `outbox` row does not list `weekly_report` yet, leave that to F100 stage 19.
  - Out of scope: who sets the status (stage 05); the way out (stage 04); the server readers (stage 03); `changeMailboxStatus` (stage 04).

## Done when

- Step 2.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 02 (`/tmp/f085-s02`) prints `PROOF_OK`.
- The final message names the real constraint name it used, the kind list it found in step (b) (and any kind beyond the 13 of c16849f), and tells the coordinator to run `bun run db:migrate` on the shared dev DB (step C1).
