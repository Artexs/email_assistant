# s2-telegram — Stage 9

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 9 — Reports: digests table and the digest message [risky]

- [ ] **9.1 `reports` module: digest rows, the period start, `buildDigestMessage`**
  - Goal: the `reports` module owns `digests` (D16) and builds the digest message of one organization for one period from the stage 8 reads and the stage 4 renderer, with no data of another organization.
  - Files: create `apps/server/src/modules/reports/index.ts`, `apps/server/src/modules/reports/repo.ts`, `apps/server/src/modules/reports/digest.ts`, `apps/server/test/integration/reports-digest.test.ts`.
  - Interfaces:
    - `reports/repo.ts` (`DbOrTrx = Db | Transaction<DB>`):
      - `insertDigest(db: DbOrTrx, ctx: TenantContext, row: { userId: string; slotKey: string; periodStart: Date; periodEnd: Date }): Promise<string | null>` — `ON CONFLICT (org_id, user_id, slot_key) DO NOTHING`; null = the slot has a row already.
      - `lastDigestSlotKey(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<string | null>` — the greatest `slot_key` of the member (sent or not).
      - `lastSentDigestEnd(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<Date | null>` — the greatest `period_end` with `sent_at` set.
      - `markDigestSent(db: DbOrTrx, ctx: TenantContext, digestId: string, at: Date): Promise<boolean>` — only `WHERE sent_at IS NULL`.
    - `reports/digest.ts`:
      - `const DIGEST_ITEM_LIMIT = 100`; `const DIGEST_MAX_PERIOD_MS = 7 * 24 * 3_600_000`; `const FIRST_DIGEST_LOOKBACK_MS = 24 * 3_600_000`; `const WAITING_WINDOW_MS = 7 * 24 * 3_600_000`.
      - `interface DigestRequest { kind: "scheduled" | "on_demand"; periodStart: Date; periodEnd: Date; slot: { date: string; time: string; late: boolean } | null; now: Date }`
      - `digestPeriodStart(db: Db, ctx: TenantContext, member: { userId: string; linkedAt: Date }, now: Date): Promise<Date>`
      - `buildDigestMessage(db: Db, ctx: TenantContext, request: DigestRequest): Promise<OutMessage>`
    - `reports/index.ts` exports the functions and types above.
  - Decisions:
    - `digestPeriodStart` (P2): `start = lastSentDigestEnd ?? linkedAt − FIRST_DIGEST_LOOKBACK_MS`; then `start = max(start, now − DIGEST_MAX_PERIOD_MS)` and `start = min(start, now)` (a clock jump never gives a period that ends before it starts). A digest that failed (never sent) does not move the start, so the next sent digest covers its mail.
    - `buildDigestMessage`, in this order (reads only through the other modules' `index.ts`):
      1. `getOrganization` (tenancy) → missing → `HardError("organization not found")`; `timeZone` = its `timezone`.
      2. `listMailboxes` (mail); for each mailbox `getMailboxSettings` (config): the mode parsed with `z.enum(mailboxModes)`; no settings row → `shadow`.
      3. `range = { after: periodStart, until: periodEnd }`; `listTriagedBetween(range, { limit: DIGEST_ITEM_LIMIT })` and `countTriagedBetween(range)` (triage).
      4. `listActionsForEmails` (actions) for the listed ids; `listSummaries` (actions) for the ids of `info` rows.
      5. Each row → a `DigestItem`: `synthetic` = `isSyntheticMessageId(message_id_header)` (mail); `aiText` = `aiTextFor({ category, reasonCode: reason_code, reason, summary, modelCategory: model_category, confidence })`; `wouldDo` = `describeActions(actions of the row)`.
      6. `skippedTooOld` = `countEventsBetween(auditEvents.emailSkipped, range)` (audit); `waiting` = `countWaiting({ receivedSince: now − WAITING_WINDOW_MS })` (mail).
      7. `renderDigest({ kind, now, timeZone, slot, periodStart, mailboxes, counts, items, skippedTooOld, waiting })`.
    - The digest is the same for every member of the organization (mailboxes belong to the organization); only the period depends on the member.
    - No log line here holds mail data; the function logs nothing (the callers log ids and counts).
  - Test (`reports-digest.test.ts`, `withRollback`; orgs A and B with `createOrgWithMailbox`; `insertDefaultSettings` for A's mailbox; `markSynced` for A's mailbox at `T − 5 min`; `T` = `2026-11-06T07:00:00Z`; markers `MARKER-SUBJECT-A`, `MARKER-SUBJECT-B`, `MARKER-REASON`, `MARKER-SUMMARY`):
    1. `insertDigest` → an id; the same slot again → null; `lastDigestSlotKey` → the greatest key; `lastSentDigestEnd` → null, then after `markDigestSent` → that `period_end`; `markDigestSent` again → false; with B's context → null / false.
    2. `digestPeriodStart`: no sent digest → `linkedAt − 24 h`; a sent digest with end `E` → `E`; `E` = `T − 10 days` → `T − 7 days`.
    3. `buildDigestMessage(A, { kind: "scheduled", periodStart: T − 15 h, periodEnd: T, slot: { date: "2026-11-06", time: "08:00", late: false }, now: T })` with, in the window: an `urgent` result (`reason` `MARKER-REASON`, subject `MARKER-SUBJECT-A`) with a `logged` `flag` action (`createPlanned`), and an `info` result with a `ready` `save_summary` (`MARKER-SUMMARY`) and a `logged` move to `ai_info`; and in B the same window an `urgent` result with subject `MARKER-SUBJECT-B`. Then the text contains `1. 🔴 Urgent ·`, `MARKER-SUBJECT-A`, `💬 MARKER-REASON`, `→ would flag`, `💬 MARKER-SUMMARY`, `→ would move to AI/Info`, `🔄 Last sync 07:55`, and never `MARKER-SUBJECT-B`; the first button row has `fr:u:<urgent id>` and `fe:<urgent id>`.
    4. A result before `periodStart` does not show and is not counted.
    5. An empty window → `No new mail since …` and `🔄 Last sync 07:55`.
    6. One `email.skipped` audit row in the window → `📭 Not processed (older than 7 days): 1`; one `pending` e-mail received yesterday → `⏳ Waiting for triage: 1`.
    7. A result whose e-mail has the Message-ID `<x@ea-seed.test>` → its line has `🧪 test`.
    8. A mailbox without a settings row → the shadow line is in the text.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: when a digest is due and the outbox row (stage 13), `/digest` (stage 17), sending (stage 11).
