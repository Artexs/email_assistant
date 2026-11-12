# s2-telegram — Stage 8

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 8 — Read queries and the mailbox status time [risky]

- [x] **8.1 Mail, triage, actions and audit queries for digests and notices; `status_changed_at`**
  - Goal: the owning modules give the reads that `reports` and `channels` need (D16: no module reads another module's tables), each filtered by `org_id`; the mailbox status keeps the time of its last real change (D6).
  - Files: change `apps/server/src/modules/mail/repo.ts`, `mail/jobs.ts`, `mail/index.ts`; `apps/server/src/modules/triage/repo.ts`, `triage/index.ts`; `apps/server/src/modules/actions/repo.ts`, `actions/index.ts`; `apps/server/src/modules/audit/repo.ts`, `audit/index.ts`; `apps/server/test/integration/fixtures.ts` (`insertTriaged`); `apps/server/test/integration/mail-jobs.test.ts` (one more assertion); create `apps/server/test/integration/s2-read-queries.test.ts`.
  - Interfaces:
    - `mail/repo.ts`:
      - `setMailboxStatus(db, ctx, mailboxId, status, at?: Date): Promise<void>` — the existing function gets an optional last parameter. It sets `status_changed_at` only when the status really changes: `status_changed_at = CASE WHEN status IS DISTINCT FROM <new> THEN <at or now()> ELSE status_changed_at END`. The update stays unconditional (an `auth_error` from the sync job always wins over a pause, P6).
      - `changeMailboxStatus(db, ctx, mailboxId, change: { from: "active" | "paused"; to: "active" | "paused"; at: Date }): Promise<boolean>` — conditional (`WHERE status = from`); sets `status = to`, `status_changed_at = at`; true when one row changed. Stage 18 uses it for `/pause` and `/resume`.
      - `interface MailboxSummary { id: string; address: string; status: "active" | "auth_error" | "paused"; last_synced_at: Date | null; status_changed_at: Date; created_at: Date }`; `listMailboxes(db, ctx): Promise<MailboxSummary[]>` — ordered by `created_at`, `id`; the status is parsed with Zod.
      - `countWaiting(db, ctx, opts: { receivedSince: Date }): Promise<number>` — e-mails with status `pending` or `processing` and `received_at >= receivedSince`, all mailboxes of the org.
    - `mail/jobs.ts`: `setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", deps.now())`.
    - `triage/repo.ts`:
      - `interface TriagedItemRow { email_id: string; mailbox_id: string; category: Category; confidence: number; reason_code: string; reason: string | null; model_category: Category | null; triaged_at: Date; received_at: Date; from_address: string | null; subject: string | null; message_id_header: string | null }`
      - `listTriagedBetween(db, ctx, range: { after: Date; until: Date }, opts: { limit: number; categories?: readonly Category[] }): Promise<TriagedItemRow[]>`
      - `countTriagedBetween(db, ctx, range: { after: Date; until: Date }): Promise<Partial<Record<Category, number>>>`
    - `actions/repo.ts`: `listActionsForEmails(db, ctx, emailIds: readonly string[]): Promise<Map<string, ActionView[]>>` (`ActionView` from `@ea/core`, step 3.2).
    - `audit/repo.ts`: `countEventsBetween(db, ctx, event: string, range: { after: Date; until: Date }): Promise<number>`.
    - Fixture `insertTriaged(trx, ctx, mailboxId, opts: { category: Category; createdAt: Date; receivedAt?: Date; reason?: string | null; reasonCode?: string; confidence?: number; fields?: Record<string, unknown>; subject?: string | null; from?: string | null; messageId?: string | null }): Promise<string>` — inserts an `emails` row (status `triaged`) and a `triage_results` row with the given `created_at` (a direct insert: `insertTriageResult` has no time parameter); returns the e-mail id.
  - Decisions:
    - `listTriagedBetween` SQL shape (Kysely; the `sql` template only where Kysely cannot express it):
      ```sql
      WITH latest AS (
        SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, tr.confidence, tr.reason_code, tr.reason, tr.fields, tr.created_at
        FROM triage_results tr
        WHERE tr.org_id = $org AND tr.created_at > $after AND tr.created_at <= $until
        ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
      )
      SELECT latest.*, e.mailbox_id, e.received_at, e.from_address, e.subject, e.message_id_header
      FROM latest JOIN emails e ON e.id = latest.email_id AND e.org_id = $org
      [WHERE latest.category IN (...categories)]
      ORDER BY CASE latest.category WHEN 'urgent' THEN 1 WHEN 'needs_reply' THEN 2 WHEN 'delegation' THEN 3
                 WHEN 'unsure' THEN 4 WHEN 'info' THEN 5 WHEN 'notification' THEN 6 ELSE 7 END,
               e.received_at DESC, latest.email_id
      LIMIT $limit
      ```
      `triaged_at` = `latest.created_at`. `model_category` = `fields->>'model_category'` parsed with `categorySchema.safeParse` (invalid → null; the same rule as `readModelCategory` in `feedback.ts`). The window `after < created_at ≤ until` uses the index `triage_results_org_created_idx`.
    - `countTriagedBetween`: the same `latest` CTE, `GROUP BY category`; parse the category with `categorySchema`; the count comes as a string → `Number`.
    - `listActionsForEmails`: `select email_id, type, status, payload->>'folder' as folder from actions where org_id and email_id in (…) order by created_at, id`. A type that is not in `actionTypes` is left out; a folder that is not in `folderKeys` → `null`. Empty `emailIds` → an empty Map without a query.
    - `countEventsBetween`: `org_id`, `event`, `after < created_at ≤ until` (index `audit_log_org_event_created_idx`).
    - All new functions take a `TenantContext` and filter by `org_id`; joins also filter the joined table by `org_id` (the S1b pattern).
  - Test (`s2-read-queries.test.ts`, `withRollback`; two orgs A and B from `createOrgWithMailbox`; fixed times around `T` = `2026-11-06T10:00:00Z`):
    1. `setMailboxStatus`: active → `auth_error` at `T` → `status_changed_at` = `T`; `auth_error` again at `T + 1 h` → still `T`; → `active` at `T + 2 h` → `T + 2 h`; with no `at` → a value near the DB `now()` (only check that it changed).
    2. `mail-jobs.test.ts` ("a login error sets auth_error …"): also `status_changed_at` = the job's `now()`.
    3. `changeMailboxStatus`: active → paused → true; the same again → false; paused → active → true; an `auth_error` mailbox with `from: "active"` → false and the status stays `auth_error`; org B's context on org A's mailbox → false.
    4. `listMailboxes(A)`: A's two mailboxes (add one with the inner `insertMailbox`) in `created_at` order; never B's mailbox.
    5. `countWaiting`: `pending` and `processing` mail received after `since` count; `triaged`, older mail and B's mail do not.
    6. `listTriagedBetween`: a result at `T − 10 min` is in the window `(T − 1 h, T]`; one at `T − 2 days` is not; a result exactly at `after` is not, exactly at `until` is; an e-mail with two results gives one row (the newer); the category filter works; the order is urgent first, then the other categories, newest `received_at` first inside a category; `limit` works; `model_category` comes from `fields`; B's results never show in A's list.
    7. `countTriagedBetween`: the counts per category for the same data; B's rows are not counted.
    8. `listActionsForEmails`: the actions of two e-mails in creation order with their folder keys; a payload folder `"x"` → `null`; B's actions are not in A's map; `[]` → empty Map.
    9. `countEventsBetween(email.skipped)`: rows inside and outside the window and B's rows → only A's rows inside count.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int` (run twice: the tests must not depend on other rows in the dev DB).
  - Done when: the tests pass in both runs.
  - Out of scope: the digest assembly (stage 9), notices (stage 12), `/pause` (stage 18).
