# s5d-web-activity — Stage 3

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 3 — Read-model repositories [risky]

One step. The activity list shows mail subjects and senders: a missing `org_id` filter would show another organization's mail.

- [x] **3.1 `listActivityRows`, `listLatestFeedbackByEmailIds`, `listLatestDelegationsByEmailIds` (B6)**
  - Goal: three batched queries that the read model (stage 4) needs, each filtered by the tenant.
  - Files: change `apps/server/src/modules/triage/repo.ts`, `triage/index.ts`, `apps/server/src/modules/delegation/repo.ts`, `delegation/index.ts`; create `apps/server/test/integration/activity-repo.test.ts`.
  - Interfaces:

    ```ts
    // triage/repo.ts
    export interface ActivityRowsQuery {
      mailboxId?: string;
      categories?: readonly Category[];
      notRated: boolean;
      since: Date;
      cursor?: { receivedAtKey: string; id: string };
      limit: number;
    }
    export interface ActivityRow {
      email_id: string;
      mailbox_id: string;
      received_at: Date;
      received_at_key: string; // "2026-11-11T09:00:00.123456Z", UTC, microseconds
      triaged_at: Date; // created_at of the latest triage result
      from_address: string | null;
      subject: string | null;
      folder: string;
      category: Category;
      confidence: number;
      reason_code: string;
      reason: string | null;
      model_category: Category | null;
    }
    export async function listActivityRows(
      db: DbOrTrx,
      ctx: TenantContext,
      q: ActivityRowsQuery
    ): Promise<ActivityRow[]>;
    export interface LatestFeedbackRow {
      verdict: FeedbackVerdict;
      true_category: Category | null;
      source: FeedbackSource;
      created_at: Date;
    }
    export async function listLatestFeedbackByEmailIds(
      db: DbOrTrx,
      ctx: TenantContext,
      emailIds: readonly string[]
    ): Promise<Map<string, LatestFeedbackRow>>;

    // delegation/repo.ts
    export interface LatestDelegationRow {
      status: DelegationStatus;
      due_at: Date | null;
      delegate_name: string | null;
    }
    export async function listLatestDelegationsByEmailIds(
      db: DbOrTrx,
      ctx: TenantContext,
      emailIds: readonly string[]
    ): Promise<Map<string, LatestDelegationRow>>;
    ```

  - Decisions:
    - `listActivityRows`: one raw `sql` query in the style of `listTriagedBetween` (same file):

      ```sql
      WITH latest AS (
        SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, tr.confidence, tr.reason_code, tr.reason,
               tr.fields->>'model_category' AS model_category, tr.created_at
        FROM triage_results tr
        JOIN emails e ON e.id = tr.email_id AND e.org_id = ${orgId}
        WHERE tr.org_id = ${orgId} AND e.received_at >= ${since} ${mailboxFilter}
        ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
      )
      SELECT latest.*, e.mailbox_id, e.received_at,
             to_char(e.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_key,
             e.from_address, e.subject, e.folder
      FROM latest JOIN emails e ON e.id = latest.email_id AND e.org_id = ${orgId}
      WHERE true ${categoryFilter} ${notRatedFilter} ${cursorFilter}
      ORDER BY e.received_at DESC, e.id DESC
      LIMIT ${limit}
      ```

      `mailboxFilter` = `AND e.mailbox_id = ${mailboxId}`; `categoryFilter` = `AND latest.category IN (…)`, and `categories: []` gives `AND false`; `notRatedFilter` = `AND NOT EXISTS (SELECT 1 FROM triage_feedback f WHERE f.org_id = ${orgId} AND f.email_id = e.id)`; `cursorFilter` = `AND (e.received_at, e.id) < (${key}::timestamptz, ${id}::uuid)`. Values only as bound parameters (`sql` template), never string-built. Parse `category` with `categorySchema` and `model_category` with the existing `readModelCategory` of this file. The repository trusts its input (the route and the service validate); it does not clamp `since`.

    - `listLatestFeedbackByEmailIds`: `DISTINCT ON (email_id)` ordered `email_id, created_at DESC, id DESC`, `org_id` filter, chunks of 500 like `listLatestTriageByEmailIds`; `[]` → empty `Map` with no query. Parse `verdict` with `verdictSchema`, `true_category` with `categorySchema`, `source` with `z.enum(feedbackSources)`.
    - `listLatestDelegationsByEmailIds`: `delegations d LEFT JOIN delegates g ON g.id = d.delegate_id AND g.org_id = d.org_id`, `d.org_id = ctx.orgId`, `d.email_id IN (…)`, `DISTINCT ON (d.email_id)` ordered `d.email_id, d.created_at DESC, d.id DESC`; select `d.email_id, d.status, d.due_at, g.name AS delegate_name`; parse `status` with the file's `delegationStatusSchema`; `[]` → no query. (`delegates` and `delegations` are both `delegation` tables; the join stays inside the module.)
    - Export the three functions and their row types from the module indexes.

  - Test (`activity-repo.test.ts`, `withRollback`, two organizations from `createOrgWithMailbox`, `insertTriaged`, `insertTriagedWithActions`, `insertDelegate(trx, ctx, { name })`, `insertDraftAndSend(trx, ctx, mailboxId, { delegateId, delegateName })` (gives `emailId`, `draftId`, `sendId`), `insertDelegation(trx, ctx, { mailboxId, emailId, delegateId, draftActionId, sendActionId, status, dueAt, createdAt })`; a second delegation row of the same mail needs a second send row (`insertAction` type `send`, status `awaiting_approval`), because `send_action_id` is unique; `NOW = 2026-11-11T12:00:00Z`):
    1. Tenant filter: org A has 3 triaged mails, org B has 2 in the same window; `listActivityRows(A)` returns only A's 3 (by `email_id`), newest `received_at` first.
    2. Latest triage result: a mail with two results (`info` at `T`, then `urgent` at `T + 1 min`) appears once, as `urgent`; with `categories: ["info"]` it does not appear; with `["urgent"]` it does.
    3. Window: mails at `NOW − 8 days`, `NOW − 6 days`, `NOW − 1 h`; `since = NOW − 7 days` → two rows. A mail with no triage result never appears.
    4. Mailbox filter: two mailboxes in A (`createOrgWithMailbox` gives one; add a second with `insertMailbox` + `insertInboxFolder`); `mailboxId: M2` → only M2's mail; B's mailbox id with A's context → `[]`.
    5. Equal timestamps and the cursor: 5 mails of A with the same `received_at`; `limit: 2` three times, each with the cursor of the last row (`{ receivedAtKey: row.received_at_key, id: row.email_id }`) → 2 + 2 + 1 rows, all 5 ids exactly once, order `email_id DESC` inside the equal time.
    6. Microseconds: update one mail's `received_at` to `'2026-11-11 10:00:00.123456+00'` by SQL; its `received_at_key` is `"2026-11-11T10:00:00.123456Z"`; a cursor made from it excludes that row and includes the next older one.
    7. `notRated: true`: of two mails of A, the one with a feedback row (`insertFeedback`, any verdict and source) is left out and the other stays; with `notRated: false` both show.
    8. `categories: []` → `[]`.
    9. `model_category`: a result with `fields: { model_category: "info" }` gives `"info"`; `fields: { model_category: "bogus" }` gives `null`.
    10. `listLatestFeedbackByEmailIds`: a mail with two feedback rows → the newer one (age the first row by one minute before the second insert: one transaction gives both the same `created_at`, cold review finding 4); an id of org B passed with A's context → not in the map; `[]` → empty map (count the queries with the plugin of fact 7: zero).
    11. `listLatestDelegationsByEmailIds`: a mail with one delegation (status `drafted`, `due_at` set, delegate "Ola") → `{ status: "drafted", due_at, delegate_name: "Ola" }`; a mail with two delegation rows (`createdAt` one minute apart) → the newer; org B's delegation with A's context → not in the map; `[]` → no query.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; every new query has `org_id` in its `WHERE` (read the SQL).
  - Out of scope: the composition (stage 4); an index (B6: none).
