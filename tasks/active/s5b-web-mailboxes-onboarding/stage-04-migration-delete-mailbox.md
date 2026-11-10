# s5b-web-mailboxes-onboarding — Stage 4

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 4 — Migration `delete_mailbox` and the `mailbox_removed` kind; the deletion tests [risky]

One step. The function is the only code path that may delete `audit_log` rows (ADR 0011: `app` has no `DELETE` on it).

- [x] **4.1 `db/migrations/20261111000001_delete_mailbox.sql`, the kind in `channels/repo.ts`, the tests (B7, D11)**
  - Goal: one privileged SQL function removes a mailbox and every row that belongs to it, clears the shared digest texts, and refuses a mailbox of another organization.
  - Files: create `db/migrations/20261111000001_delete_mailbox.sql`, `apps/server/test/integration/mailbox-rows.ts` (test helper), `apps/server/test/integration/delete-mailbox.test.ts`; change `apps/server/src/modules/channels/repo.ts` (`outboxKinds` + `"mailbox_removed"`); run `bun run db:types` (expected: no change, the kind is `text`; commit `apps/server/src/platform/db/schema.ts` only if it changed).
  - Interfaces:

    ```sql
    -- migrate:up
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed'));

    -- One privileged path for the delete (docs/architecture.md §7): `app` may not delete audit rows.
    CREATE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
      END IF;
      DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
      -- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text.
      DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
      UPDATE public.outbox SET text = '[removed]' WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
      DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
    END;
    $$;
    REVOKE ALL ON FUNCTION delete_mailbox(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION delete_mailbox(uuid, uuid) TO app;

    -- migrate:down
    DROP FUNCTION delete_mailbox(uuid, uuid);
    DELETE FROM outbox WHERE kind = 'mailbox_removed';
    ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
    ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
      'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
      'approval', 'approval_set', 'send_result', 'delegation_answered'));
    ```

    ```ts
    // test/integration/mailbox-rows.ts
    export interface MailboxIds {
      mailboxId: string;
      emailIds: string[];
      actionIds: string[];
    }
    // One row (at least) in every table that belongs to the mailbox: an email with a triage result, a feedback row, actions,
    // a delegation (with a delegate), a mailbox-scoped sender rule, audit rows (one with email_id, one with action_id,
    // one with only data.mailbox_id), outbox rows (urgent with email_id, auth_error with mailbox_id), the INBOX mailbox_folders
    // row (createOrgWithMailbox makes it), credentials and settings rows.
    export async function fillMailbox(
      trx: Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      userId: string
    ): Promise<MailboxIds>;
    // Counts per table for one mailbox; the email and action ids come from the snapshot taken before a delete.
    export async function countMailboxRows(
      trx: Transaction<DB>,
      orgId: string,
      ids: MailboxIds,
      // Audit rows of these events are not counted: stage 5 writes `mailbox.removed` with data.mailbox_id after the delete.
      opts?: { exceptEvents?: readonly string[] }
    ): Promise<Record<string, number>>;
    ```

  - Decisions:
    - The version `20261111000001` sorts after `20261110000001_web_panel.sql`. The migration runs as `migrator` (dbmate), so `migrator` owns the function and the function may delete `audit_log` rows. `SET search_path = pg_catalog, public, pg_temp` plus `public.` on every table stops a caller's `search_path` or a temporary table from swapping a table: Postgres searches `pg_temp` first unless it is listed, and `app` may create temporary tables (B7; cold review finding 3).
    - The function does not delete `sender_rules` itself: the FK `(mailbox_id, org_id) → mailboxes ON DELETE CASCADE` does (fact 4). It does not touch `digests` rows (fact 5).
    - `countMailboxRows` counts, by explicit table name: `mailboxes`, `mailbox_credentials`, `mailbox_settings`, `mailbox_folders`, `emails`, `triage_results`, `triage_feedback`, `actions`, `delegations`, `sender_rules` (by `mailbox_id`), `audit_log` (by `email_id`, by `action_id`, and by `data->>'mailbox_id'`, three keys), `outbox` (by `mailbox_id` and by `email_id`, two keys). The helper uses the fixtures `insertTriagedWithActions`, `insertDelegate`, `insertDelegation`, `linkChat`, and `recordAudit`, `insertOutbox`, `insertSenderRule`, `insertDefaultSettings`, `insertCredentials` (read their signatures in `fixtures.ts` and the module indexes; do not change them).
    - `channels/repo.ts` `outboxKinds` gains `"mailbox_removed"` now, because `claimDueOutbox` parses every claimed kind.
  - Test (`delete-mailbox.test.ts`, `withRollback`; `sql` from `kysely` for the calls):
    1. Org A with mailboxes M1 and M2 (the second through `insertMailbox` + `insertInboxFolder` + `insertDefaultSettings`), org B with M3; `fillMailbox` for all three; a linked owner chat in A and B; outbox `digest` rows in A (one each in `pending`, `sending`, `sent`, `failed`; `insertDigest` + `insertOutbox`, then set the status with an `UPDATE`; `sent` needs `sent_at`, `sending` needs `locked_at`: the CHECKs) and one `sent` digest in B. Counts of M2 and M3 before. `SELECT delete_mailbox(A, M1)` → every M1 count is 0 (assert the whole record, each table named); M2 and M3 counts equal their before values.
    2. In the same setup: org A's `pending` and `sending` digest rows are gone; its `sent` and `failed` rows have `text = '[removed]'`; org B's `sent` digest keeps its text; A's `digests` rows still exist.
    3. `delete_mailbox(B, M1)` (M1 is A's) → an error with `code` `P0002`; every M1 count unchanged (run it in a savepoint, because the error aborts the test transaction otherwise: the pattern of `triage-schema.test.ts:32-46`, `sql\`savepoint …\``and`rollback to savepoint …`).
    4. `delete_mailbox(A, <random uuid>)` → `P0002`.
    5. Grants: `SELECT has_function_privilege('app', 'delete_mailbox(uuid, uuid)', 'EXECUTE')` → true; `SELECT proacl::text, prosecdef, proconfig FROM pg_proc WHERE proname = 'delete_mailbox'` → `prosecdef` true, `proconfig` contains `search_path=pg_catalog, public, pg_temp`, and no ACL entry starts with `=` (no `PUBLIC` grant).
    6. Temporary-table guard: in the test transaction `CREATE TEMP TABLE mailboxes (id uuid, org_id uuid)` and insert `(<M2's id>, <B's org id>)`; then `delete_mailbox(B, M2)` → `P0002` (in a savepoint; the function reads `public.mailboxes`, not the temporary one), and M2's counts are intact.
       6a. `app` still cannot delete an audit row directly: `DELETE FROM audit_log WHERE id = …` → error `42501` (in a savepoint, as test 3).
    7. An outbox row of kind `mailbox_removed` with no `mailbox_id`, no `email_id`, no `digest_id` inserts through `insertOutbox`; kind `nonsense` is refused (`23514`).
    8. Round trip (Check, not a test): `bun run db:rollback` then `bun run db:migrate` on the build database; both succeed.
  - Check: the database guard, then `bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`, then the round trip of test 8 and `git diff --stat apps/server/src/platform/db/schema.ts`.
  - Done when: the tests pass; the round trip passes; `grep -c "SECURITY DEFINER" db/migrations/*.sql` shows exactly this file.
  - Out of scope: `removeMailbox`, the notice (stage 5).
