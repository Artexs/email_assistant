# s5d-web-activity — Stage 4

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 4 — `listActivity`, the cursor, the query count [risky]

One step. The page shows what the assistant did to a mail and offers Undo by this data: a wrong `undoable` or phrase misleads the user about changes in their mailbox.

- [x] **4.1 `reports/activity.ts` (B7)**
  - Goal: one service builds a page of activity items with the digest's words, in a fixed number of queries.
  - Files: create `apps/server/src/modules/reports/activity.ts`, `apps/server/test/integration/reports-activity.test.ts`; change `reports/index.ts`.
  - Interfaces:

    ```ts
    import type { ActivityWebPage, Category } from "@ea/core";
    export interface ActivityCursor {
      receivedAtKey: string;
      id: string;
    }
    export interface ActivityQuery {
      mailboxId?: string;
      categories?: readonly Category[];
      notRated: boolean;
      since?: Date;
      cursor?: ActivityCursor;
      limit?: number; // default ACTIVITY_PAGE_SIZE
    }
    export function encodeActivityCursor(cursor: ActivityCursor): string;
    export function decodeActivityCursor(text: string): ActivityCursor | null;
    export async function listActivity(
      db: Db,
      ctx: TenantContext,
      query: ActivityQuery,
      now: Date
    ): Promise<ActivityWebPage>;
    ```

  - Decisions:
    - Window: `const oldest = now − ACTIVITY_MAX_DAYS days; const since = max(query.since ?? now − activityRangeMs["7d"], oldest)`.
    - Queries, in this order (at most 7): `listActivityRows(db, ctx, { …, since, limit: limit + 1 })` (triage); then with the page ids: `listActionsForEmails` (actions), `listSummaries` (only `info` ids; skipped when none), `listDraftTasks` (only `delegation` ids; skipped when none), `listLatestFeedbackByEmailIds` (triage), `listLatestDelegationsByEmailIds` (delegation), `listDelegateNames` (delegation; the `delegateId`s of the actions; skipped when none). With no rows: one query and `{ items: [], nextBefore: null }`. All imports through the module indexes (`../triage`, `../actions`, `../delegation`; `reports` imports them today, fact 12).
    - Item (field by field):
      - `emailId`, `mailboxId`; `receivedAt` = `row.received_at.toISOString()`; `triagedAt` = `row.triaged_at.toISOString()`.
      - `from` = `row.from_address`, `subject` = `row.subject` (raw; the web shows "(unknown sender)" / "(no subject)" for `null`).
      - `category`, `confidence`, `modelCategory` from the row.
      - `aiText` = `aiTextFor({ category, reasonCode: row.reason_code, reason: row.reason, summary: summaries.get(id) ?? null, modelCategory, confidence, task: tasks.get(id) ?? null })`.
      - `phrase` = `describeActions(actions, names, { stayFolder: row.folder })` (`actions` = `actionsByEmail.get(id) ?? []`).
      - `actions` = `actions.filter((a) => !a.reverse).flatMap((a) => { const p = describeAction(a, names); return p === null ? [] : [{ type: a.type, status: a.status, phrase: p, appliedAt: a.appliedAt?.toISOString() ?? null }]; })`.
      - `undoable` = `isUndoable(actions, now)`; `undoPending` = `actions.some((a) => a.reverse && (a.status === "ready" || a.status === "applying"))`.
      - `feedback` = the map row → `{ verdict, trueCategory: true_category, source, at: created_at.toISOString() }` or `null`.
      - `delegation` = the map row → `{ delegateName: delegate_name, status, dueAt: due_at?.toISOString() ?? null }` or `null`.
    - `nextBefore` = `rows.length > limit ? encodeActivityCursor({ receivedAtKey: page.at(-1).received_at_key, id: page.at(-1).email_id }) : null`.
    - Cursor text = ``Buffer.from(`${receivedAtKey}|${id}`, "utf8").toString("base64url")``. Decode: not `/^[A-Za-z0-9_-]+$/` → `null`; split on `|` must give exactly two parts; `id` must pass `z.uuid()`; `receivedAtKey` must match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/` and `new Date(key)` must not be `NaN`. Any failure → `null`.
    - The service returns plain JSON data; it never logs mail text.
  - Test (`reports-activity.test.ts`, `withRollback`, `createOrgWithMailbox` (two organizations), the fixtures of stage 3; `NOW = 2026-11-11T12:00:00Z`; count queries with the plugin of fact 7 on `trx.withPlugin(counter)`):
    1. A moved `notification` mail (`move` `ai_notifications` and `mark_read`, both `applied` at `NOW − 1 h`): item `phrase` = `"done: move to AI/Notifications, mark read"`, `actions` = two entries with phrases `"done: move to AI/Notifications"`, `"done: mark read"` and their `appliedAt`, `undoable: true`, `undoPending: false`, `aiText` = the reason.
    2. After an `undo()` of that mail (`actions.undo` with scope `synthetic` and a synthetic Message-ID) → `undoable: false`, `undoPending: true`; after the reverse rows are set `status = 'applied', applied_at = NOW − 10 min` and the originals `status = 'undone'` by SQL (`actions_applied_at_check` needs `applied_at` on both; the originals keep theirs) → `phrase` starts with `"undone:"`, `undoPending: false`.
    3. `info` with a `save_summary` action (payload `summary`) → `aiText` = the summary; `unsure` with `fields.model_category = "info"`, confidence 0.45, reason "Hard to tell." → `aiText` = `"Hard to tell. (AI guess: Info, 45%)"`; a mail with no action → `phrase` = `"stays in INBOX"`, `actions` = `[]`, `undoable: false`.
    4. A delegation mail (`insertDraftAndSend` + `insertDelegation` `drafted`, `dueAt`, delegate "Ola", task "Send the Q4 report") → `aiText` = the task, `phrase` contains `"draft a delegation to Ola"` and `"waits for your approval"`, `delegation` = `{ delegateName: "Ola", status: "drafted", dueAt }`.
    5. Feedback: a ✅ row → `feedback.verdict = "right"`, `trueCategory` = the category, `source` = the row's source.
    6. Paging: 5 mails with equal `received_at`; `limit: 2` → `nextBefore` not null; following the cursor gives 2, 2, 1 items, each id once, the last page has `nextBefore: null`.
    7. Window: `since` = `NOW − 120 days` with mails at `NOW − 100 days` and `NOW − 80 days` → only the second (the 90-day clamp); no `since` → the 7-day default.
    8. Tenant: another organization's mails never appear; its `mailboxId` with this context → `items: []`.
    9. Query count: a page with 3 mails (one `info` with summary, one delegation with a delegate, one moved) → at most 7 queries; a page with 60 such mails (`limit: 100`) → the same count; an empty result → 1 query.
    10. Cursor codec (unit-like, in the same file or in `reports/activity.test.ts` as a unit test): `decodeActivityCursor(encodeActivityCursor(c))` equals `c`; `decodeActivityCursor("x")`, a valid base64url of `"a|b"`, of `"2026-11-11T10:00:00.000000Z|not-a-uuid"`, of three parts, and `"%%%"` → `null`.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `reports/index.ts` exports `listActivity`, `encodeActivityCursor`, `decodeActivityCursor`, `type ActivityQuery`, `type ActivityCursor`.
  - Out of scope: the route (stage 5).
