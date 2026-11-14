# F085 stage 02 — Migration, server status type, the notice kind `host_blocked` [risky]

Part of [`../plan.md`](../plan.md). Read its D1, D2, D7, D8, D17, D18, "Rules for every stage", and `docs/code-patterns.md` § Notices are facts and § Add a notice kind first. Needs stage 01 (`mailboxStatuses` with `host_blocked`, `renderHostBlockedNotice`, the texts).

`[risky]`: a migration (two CHECK lists) and a message to people. A review job checks it before the land. No other migration of any ticket may be in build while this stage runs. After the land the coordinator runs `bun run db:migrate` on the shared dev DB (plan.md step C1).

One step (the checklist "Add a notice kind", steps 1–5, plus the mailbox status in the same migration). About 260 changed lines.

After this stage the DB accepts `host_blocked`, the server parses it and the notifier queues the notice for a mailbox in that status. No code sets the status yet (stage 05); only tests do.

- [ ] **2.1 The status in the DB and the server, and the notice kind**
  - Goal: a mailbox row may hold `host_blocked`; every linked owner gets one `host_blocked` notice per episode of that status.
  - Files (the checklist order):
    - core: `packages/core/src/notices/kinds.ts` (`"host_blocked"` after `"send_held"`); `views.ts` (`hostBlockedView` and the entry `host_blocked: hostBlockedView` after `send_held`); `renderers.ts` (entry after `send_held`, `telegram.full` calls `renderHostBlockedNotice(view, textsFor(opts.locale))` as the `auth_error` entry does); `packages/core/src/notices/registry.test.ts` (one case for the new kind, as the `auth_error` case near line 136).
    - migration: `db/migrations/<build day><HHMMSS>_mailbox_host_blocked.sql`, a timestamp later than the newest file in `db/migrations/` (at the plan base: `20261114130001_two_factor.sql`; check `ls db/migrations | tail -3` at your start). Then `bun run db:migrate` on your job DB and `bun run db:types` (no change expected: `status` and `kind` are `string`; commit any change it makes).
    - server: `apps/server/src/modules/mail/repo/mailboxes.ts` (lines 121–122): `MailboxStatus` and `mailboxStatusSchema` come from core (D2). `apps/server/src/modules/channels/repo.ts` (`cancelPendingOutbox`, line 460): the `kind` union gains `"host_blocked"`. New file `apps/server/src/modules/channels/notices/host-blocked.ts`. `apps/server/src/modules/channels/notices/index.ts`: import it and list `hostBlockedDetector` right after `authErrorDetector` in `detectors`.
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

    Migration (exact; the constraint name `mailboxes_status_check` is not verified, see below):

    ```sql
    -- migrate:up
    ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
    ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused', 'host_blocked'));
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'host_blocked'));
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
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held'));
    ALTER TABLE mailboxes DROP CONSTRAINT mailboxes_status_check;
    ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_status_check CHECK (status IN ('active', 'auth_error', 'paused'));
    ```

    Before you write it: (a) read the real name of the status CHECK on your job DB: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'mailboxes'::regclass and contype = 'c';` (use `psql "$DATABASE_URL"` of your job `.env`, or a one-off `bun -e` with the test DB helper; print only `conname` and the definition). Use that name in both parts. (b) Read the newest migration that sets `outbox_kind_check` (`grep -l outbox_kind_check db/migrations/*.sql | tail -1`): if a later ticket added a kind, keep its list and add `'host_blocked'`, in the `down` part too.
  - Decisions: D1, D2, D7, D8, D17. The notice waits for the quiet hours like every non-digest notice. A suspended organization gets no notice (`listLinkedChats` skips it; the sender does not claim its rows).
  - Test (`channels-notices.test.ts` helpers `org`, `run`, `setStatus`, `rows`, `isolateChannels`; `T = 2026-11-06T10:00:00Z`; owner and assistant linked):
    1. `setStatus(trx, o, "host_blocked", at(-20 * MINUTE))`; `run` twice → exactly one `host_blocked` row, `user_id` = the owner, `dedup_key` = `host_blocked:<mailboxId>:<at(-20 min) ms>`, `mailbox_id` set, `status` `pending`; no row for the assistant.
    2. The row's `view` equals `{ address: <the mailbox address>, since: at(-20 min).toISOString(), now: T.toISOString(), timeZone: "Europe/Warsaw" }` and has no other key.
    3. `renderedOf(row)` → the text contains the mailbox address and none of `imap.x.test`, `smtp.x.test` (the fixture hosts) (D8).
    4. New episode: `setStatus(trx, o, "active")`, then `setStatus(trx, o, "host_blocked", at(-2 * MINUTE))`, `run` → two rows; the first is `failed` / `outdated`, the second `pending`.
    5. A pending row, then `setStatus(trx, o, "active")` and `run` → that row is `failed` / `outdated`; no new row.
    6. A `paused` mailbox and an `auth_error` mailbox → no `host_blocked` row (the `auth_error` one gets its own `auth_error` row as before).
    7. `telegram-schema.test.ts`: inserting a `host_blocked` outbox row with `mailbox_id` null fails with `23514` (use the file's `insertOne` and `expectCode` helpers, as for the `send_held` check if one exists, else as for `detail`).
    8. `mail-repo.test.ts` (new test in the `mail repository: mailboxes` describe): the values of the mailbox status CHECK (`pg_get_constraintdef` of the constraint, the quoted words, sorted) equal `[...mailboxStatuses].sort()` from `@ea/core`; an update of a mailbox to `host_blocked` succeeds and `getMailboxSummary` returns `status: "host_blocked"`; an update to `frozen` fails with `23514`.
    9. The completeness tests pass: `apps/server/src/modules/channels/notices/registry.test.ts`, `packages/core/src/notices/registry.test.ts`, `telegram-schema.test.ts` "the CHECK lists match the lists of core".
  - Check: `bun run db:migrate`; `bun run db:types`; `bun test packages/core/src/notices packages/core/src/digest apps/server/src/modules/channels apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/telegram-schema.test.ts apps/server/test/integration/mail-repo.test.ts apps/server/test/integration/channels-sender.test.ts`; then `bun run db:rollback` and `bun run db:migrate` once more (the `down` part must run on your job DB); `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–9 pass; the rollback and the second migrate run without an error; `docs/architecture.md` §5 rows `mailboxes` (status list) and `outbox` (kind, dedup key `host_blocked:<mailbox id>:<status_changed_at ms>`) and the `channels` table of `docs/modules.md` §3.8 (`notices/` row: `host-blocked.ts`) name the change (checklist step 5; the full docs come in stage 07).
  - Out of scope: who sets the status (stage 05); the way out (stage 04); the server readers (stage 03); `changeMailboxStatus` (stage 04).

## Done when

- Step 2.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 02 (`/tmp/f085-s02`) prints `PROOF_OK`.
- The final message names the real constraint name it used, and tells the coordinator to run `bun run db:migrate` on the shared dev DB (step C1).
