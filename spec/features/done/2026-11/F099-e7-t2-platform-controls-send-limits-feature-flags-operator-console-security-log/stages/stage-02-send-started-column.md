# F099 stage 02 — Send start column [risky]

Part of [`../plan.md`](../plan.md). Read its D4, D5, D12, "Facts checked" and "Rules for every stage" first. Needs stage 01 (`RecentSend` in `@ea/core`) and F091 landed (the `actions/repo/` files).

`[risky]`: a migration on `actions`, the table of every send. A review job checks it before the land. No other migration of any ticket may be in build while this stage runs. After the land the coordinator runs `bun run db:migrate` on the shared dev DB (plan.md step C1).

Two steps. About 200 changed lines.

- [ ] **2.1 Migration `send_started_at`**
  - Goal: every send that may have reached people has the time its SMTP try started.
  - Files:
    - add `db/migrations/<build day>100001_send_started_at.sql` (a timestamp later than the newest file in `db/migrations/` at build time; today the newest is `20261113110001_org_features.sql`);
    - change `apps/server/src/platform/db/schema.ts` only through `bun run db:types`;
    - change `apps/server/test/integration/actions-schema.test.ts` (add one case next to "pg_indexes lists the new indexes").
  - Interfaces (the file, exact):

    ```sql
    -- migrate:up
    -- When a send entered `applying` (its SMTP try started). The send limits count sends by it (PD-044).
    ALTER TABLE actions ADD COLUMN send_started_at timestamptz;

    -- Sends that may have reached people (applying, applied, failed with an unknown outcome) get their best known time.
    UPDATE actions
    SET send_started_at = coalesce(applied_at, updated_at)
    WHERE type = 'send'
      AND (status IN ('applying', 'applied') OR (status = 'failed' AND status_reason = 'outcome_unknown'));

    CREATE INDEX actions_send_started_idx ON actions (org_id, send_started_at)
      WHERE type = 'send' AND send_started_at IS NOT NULL;

    -- migrate:down
    DROP INDEX actions_send_started_idx;
    ALTER TABLE actions DROP COLUMN send_started_at;
    ```

  - Decisions: D4, D5.
  - Test (schema test): 1. `information_schema.columns` has `actions.send_started_at` with `data_type = 'timestamp with time zone'` and `is_nullable = 'YES'`; `pg_indexes` has `actions_send_started_idx` whose `indexdef` contains `WHERE ((type = 'send'::text) AND (send_started_at IS NOT NULL))`.
  - Check: `bun run db:migrate` (the job's own DB), then `bun run db:types`, then `bun test apps/server/test/integration/actions-schema.test.ts`; then `bun run db:rollback` and `bun run db:migrate` once more (it proves the `down` part); `git diff apps/server/src/platform/db/schema.ts` shows only the new column.
  - Done when: test 1 passes; `schema.ts` has `send_started_at: Timestamp | null` in `Actions` and no other change.
  - Out of scope: any read or write of the column (step 2.2).

- [ ] **2.2 `markApplying` sets it; `listRecentSends` reads it**
  - Goal: the committer stamps the start of each SMTP try, and one tenant-scoped query returns the sends of one mailbox that count.
  - Files:
    - change the file that holds `markApplying` after F091 (`actions/repo/lifecycle.ts`);
    - change the file that holds the send-row queries after F091 (`actions/repo/sends.ts`): add `listRecentSends`;
    - change `actions/repo/index.ts` (list `listRecentSends`) and `actions/index.ts` (export it; the tests import it from the module index);
    - change `apps/server/src/modules/actions/send.ts` (step 2 passes `sendStartedAt: now`);
    - add `apps/server/test/integration/actions-send-started.test.ts`;
    - change `apps/server/test/integration/actions-send.test.ts` (one assertion in the existing test "the row is committed as applying with the outgoing id before the SMTP call").
  - Interfaces:

    ```ts
    // actions/repo/lifecycle.ts — one new optional field; a draft call passes nothing and the column keeps its value
    export async function markApplying(
      db: DbOrTrx,
      ctx: TenantContext,
      id: string,
      lockedAt: Date,
      opts?: { outgoingMessageId?: string; sendStartedAt?: Date }
    ): Promise<boolean>;
    //   .set((eb) => ({ …, send_started_at: opts?.sendStartedAt ?? eb.ref("send_started_at") }))

    // actions/repo/sends.ts — plan.md D4: the sends of one mailbox that may have reached people, started after `since`
    export async function listRecentSends(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      since: Date
    ): Promise<RecentSend[]>; // RecentSend from @ea/core; ordered by send_started_at, then id
    //   FROM actions JOIN emails ON emails.id = actions.email_id AND emails.org_id = actions.org_id
    //   WHERE actions.org_id = ctx.orgId AND emails.org_id = ctx.orgId AND emails.mailbox_id = mailboxId
    //     AND actions.type = 'send' AND actions.send_started_at > since
    //     AND (actions.status IN ('applying', 'applied') OR (actions.status = 'failed' AND actions.status_reason = 'outcome_unknown'))
    //   to = the strings of payload->'to' when it is a JSON array (other elements dropped); [] when missing or not an array
    ```

    `send.ts` step (2): `markApplying(trx, ctx, action.id, action.locked_at, { outgoingMessageId: message.messageId, sendStartedAt: now })`. Nothing else changes in `send.ts` in this stage.
  - Decisions: D4, D5, D12.
  - Test (`actions-send-started.test.ts`; `withRollback` from `helpers.ts`; rows from `createOrgWithMailbox` and `insertDraftAndSend` in `fixtures.ts`; `NOW = 2026-11-20T10:00:00Z`; `SINCE = NOW − 24 h`):
    2. `markApplying` with `sendStartedAt: NOW` on an approved send → `send_started_at = NOW`; `markApplying` on a `create_draft` row without the field → `send_started_at` stays null.
    3. A send marked at `NOW − 2 h`, put back with `releaseAction(toStatus "approved")`, marked again at `NOW` → `send_started_at = NOW`.
    4. `listRecentSends(…, SINCE)` on one mailbox with sends in status `applying` (started −1 h), `applied` (−2 h), `failed`/`outcome_unknown` (−3 h), `failed`/`smtp_rejected` (−4 h), `approved` with a stale `send_started_at` (−5 h), `expired` (−6 h), `rejected` (−7 h) → exactly the first three, in time order.
    5. A send started at exactly `SINCE` is not returned; one at `SINCE + 1 ms` is.
    6. A counted send of another mailbox of the same organization is not returned.
    7. Tenant filter: the same call with the context of a second organization and the first mailbox id → `[]`.
    8. `to`: a payload `to: ["A@x.test", 5, "b@x.test"]` → `["A@x.test", "b@x.test"]` (no lower-casing here: the core rule does it); a payload without `to` (retention cleared it: `payload = '{}'`) → `[]`.
    - `actions-send.test.ts`: 9. In "the row is committed as applying with the outgoing id before the SMTP call", the committed row also has `send_started_at = NOW` (the test's `NOW`).
  - Check: `bun test apps/server/test/integration/actions-send-started.test.ts apps/server/test/integration/actions-send.test.ts apps/server/test/integration/actions-repo.test.ts apps/server/test/integration/actions-transitions.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 2–9 pass; `listRecentSends` has its tenant-filter case (7).
  - Out of scope: the limit check (stage 03); the DSR map entry for the column (E7-T3: "not personal").

## Done when

- Steps 2.1 and 2.2 are done and committed by explicit paths (the migration, `schema.ts`, the repo files, `send.ts`, the tests).
- The Proof command of `plan.md` for stage 02 (`/tmp/f099-s02`) prints `PROOF_OK`.
- The final message tells the coordinator to run `bun run db:migrate` on the shared dev DB (step C1).
