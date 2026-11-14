# F100 stage 10 — Row readers I: the week fixture, triage and channels readers

Part of [`../plan.md`](../plan.md). Review job before the land (tenant filters on many joins).

**Wait:** stages 04 and 09 of this ticket and F097 stages 01 (`TestMailRule`, `mailKindFilter(kind, rule)`) and 03 (source `review`) must be on `master`. Check: `grep -n "export function mailKindFilter" apps/server/src/modules/mail/repo/emails.ts` shows a rule parameter, and `feedbackSources` holds `"review"`. If not, stop and say so.

After this stage one shared test fixture seeds a known week, the query shape of all readers exists, and the readers of `triage` (M1, M4) and `channels` (M5) return the stage 08–09 rows for one organization, one week and one or all mailboxes. Stage 11 adds the readers of `actions`, `delegation` and `audit` on the same fixture.

## Step 1 — The week fixture

**Goal.** One seeded week with known answers (used by stages 10, 11, 12 and 17).

**Files.** `apps/server/test/integration/metrics-fixtures.ts` (new).

**Interfaces.**

```ts
export const WEEK = "2026-11-16"; // Monday, Europe/Warsaw; range 2026-11-15T23:00Z – 2026-11-22T23:00Z
export const WEEK_NOW = new Date("2026-11-30T12:00:00Z");
export interface SeededWeek {
  orgA: { ctx: TenantContext; mailboxId: string; ownerId: string; ids: Record<string, string> };
  orgB: { ctx: TenantContext; mailboxId: string };
}
/** Seeds the scenario below inside `trx` (tests run in withRollback). */
export async function seedWeek(trx: Transaction<DB>): Promise<SeededWeek>;
```

Every triage result's `created_at` is the mail's `received_at` + 1 minute; feedback rows have the times in the table (e3's at 2026-11-18T10:30Z). Use `createOrgWithMailbox`, `insertTestEmail`, and the repository insert functions of each module (or plain Kysely inserts in the fixture; the fixture is test code). Rows must pass the table CHECKs: a `send` with status `applied` needs `approved_at`; a delegation in `sent`, `answered` or `overdue` needs `sent_message_id` and `sent_at`; a send needs its `create_draft` row as `depends_on_action_id` if the existing fixtures build it that way (copy the shape from `actions-approvals.test.ts` and `delegation-repo.test.ts`). Organization A: time zone `Europe/Warsaw`, one mailbox in `assist` mode. Times are UTC.

| Id | Mail | Triage (latest) | Rows |
| --- | --- | --- | --- |
| e1 | received 2026-11-17T09:00Z | `info` | feedback `telegram` verdict `wrong` true `urgent` at 2026-11-17T12:00Z; action `move` `ai_info` `applied` at 2026-11-17T09:01Z |
| e2 | 2026-11-17T10:00Z | `urgent` | outbox `urgent` row `sent`, `sent_at` 2026-11-17T10:03Z |
| e3 | 2026-11-18T10:00Z | `needs_reply` | feedback `review` verdict `right` true `needs_reply`; send action s1 (`payload.kind` `clarification`) `rejected`, audit `action.rejected` at 2026-11-18T13:00Z; `action_feedback` `reject_reason` `wrong_person` |
| e4 | 2026-11-18T11:00Z | `notification` | action `move` `ai_notifications` `applied` 2026-11-18T11:01Z |
| e5 | 2026-11-18T12:00Z | `spam`, `vip = true` | action `move` `ai_spam` `applied` 2026-11-18T12:01Z |
| e6 | 2026-11-19T22:30Z (23:30 local) | `urgent` | outbox `urgent` `sent` 2026-11-20T06:00Z |
| e7 | 2026-11-20T09:00Z | `delegation` | send s3 (`payload.kind` `delegation`) `applied` 2026-11-20T09:10Z; delegation `sent`, `sent_at` 2026-11-20T09:10Z, `due_at` 2026-11-23T09:00Z; `action_feedback` `mistake` on s3 |
| e8 | 2026-11-17T08:00Z, synthetic Message-ID | `urgent` | outbox `urgent` `sent` 2026-11-17T08:01Z |
| e9 | 2026-11-10T09:00Z | `info` | action `move` `ai_info` `applied` 2026-11-10T09:01Z |
| e10 | 2026-11-17T12:00Z | `urgent` | no outbox row |
| e11 | 2026-11-12T09:00Z | `delegation` | delegation d2 `answered`, `sent_at` 2026-11-13T09:00Z, `due_at` 2026-11-18T09:00Z, `answered_at` 2026-11-18T15:00Z |
| e12 | 2026-11-12T10:00Z | `delegation` | delegation d3 `overdue`, `sent_at` 2026-11-13T09:00Z, `due_at` 2026-11-19T09:00Z; audit `delegation.overdue` `{ delegation_id: d3 }` at 2026-11-20T06:30Z |
| e13 | 2026-11-19T10:00Z | `info` | send s2 `rejected`, audit `action.rejected` at 2026-11-19T13:00Z; no reason row |

Plus 10 `llm.call` audit rows of org A (`mailbox_id` = A's mailbox, model `gpt-6-luna`, 1,036 in, 80 out) at 2026-11-17T10:00Z and one at 2026-11-10T10:00Z. Organization B: one mailbox, two mails received 2026-11-17T10:00Z and 2026-11-17T11:00Z (outside quiet hours) triaged `urgent` with `sent` urgent outbox rows 2 min later, one `llm.call` row in the week, one `move` `applied` in the week (of a third mail received 2026-11-17T12:00Z, triaged `info`).

**Decisions.** D11–D16, D18.

**Test.** The readers' tests below use it.

**Check.** `bun run typecheck`

**Done when.** The file compiles; the readers' tests use it.

**Out of scope.** The service (stage 12).

## Step 2 — Query shape and the triage and channels readers

**Goal.** One query shape; the readers of the mail-level metrics (D11, D14, D15, D18, D19), each filtering `org_id` on every table it joins.

**Files.** `packages/core/src/metrics/query.ts` (new) + `metrics/index.ts`, `apps/server/src/modules/triage/metrics-repo.ts` (new; `triage/repo.ts` is over 400 lines), `apps/server/src/modules/channels/metrics-repo.ts` (new), each module's `index.ts`, `apps/server/test/integration/metrics-readers.test.ts` (new).

**Interfaces.**

```ts
// packages/core/src/metrics/query.ts — structural, so `audit` (layer 1) and `mail` users need no import of `mail`.
export interface WeekQuery {
  range: { start: Date; end: Date };
  mailboxId: string | null; // null = every mailbox of the organization
  testMail: { senders: readonly string[] }; // F097's TestMailRule has this shape
}
```

Every reader takes `(db: DbOrTrx, ctx: TenantContext, q: WeekQuery)`.

| Reader (module) | Returns | Rows |
| --- | --- | --- |
| `listTruthRows` (triage) | `MailTruthRow[]` | real mail, `received_at` in range, with a triage result; `predicted` = latest result (`DISTINCT ON (email_id) ORDER BY created_at DESC, id DESC`); latest feedback row (same order) → `truth = true_category`, `truthSource = truthSourceOf(source)`, `wrongOnly = verdict = 'wrong' AND true_category IS NULL` |
| `listHandledRows` (triage) | `HandledRow[]` | the same mail set; booleans by `EXISTS` on `actions` (original rows: `reverses_action_id IS NULL`; `type IN ('move','mark_read','flag')` by status `applied`, `undone`, `logged`; a `send` with `payload->>'kind' = 'delegation'` `applied`), `triage_feedback` (`verdict = 'wrong'` and `created_at ≤ latest result created_at + 7 days`), `delegations` (the newest of the mail has status `cancelled`) |
| `listUrgentNoticeTimes` (channels) | `UrgentNoticeRow[]` | real mail with `backfilled_at IS NULL`, `received_at` in range, latest triage category `urgent`; `noticeAt` = `MIN(outbox.sent_at)` of `kind = 'urgent'`, `status = 'sent'` rows of the mail |

Range rule: `start ≤ t < end` everywhere. `mailboxId` set → `emails.mailbox_id = $id`. The readers return no subject and no text.

**Decisions.** D11, D14, D15, D18, D19.

**Test** (integration, `metrics-readers.test.ts`, `seedWeek` in `withRollback`, `range = weekRange(WEEK, "Europe/Warsaw")`, org A's context, `mailboxId: null`, `testMail = { senders: [] }`):

1. `listTruthRows` → 9 rows (e1–e7, e10, e13; not e8 synthetic, not e9, e11, e12 of other weeks); e1 `{ predicted: "info", truth: "urgent", truthSource: "correction" }`; e3 `{ truth: "needs_reply", truthSource: "review" }`.
2. `listHandledRows` → the same 9 mails; e1 `mailboxActionApplied: true, wrongWithin7Days: true`; e4 applied; e5 applied; e7 `delegationSendApplied: true, delegationCancelled: false`.
3. `listUrgentNoticeTimes` → e2 (`noticeAt` 10:03Z), e6 (`noticeAt` 2026-11-20T06:00Z), e10 (null); not e8.
4. Tenants: in org B's context `listTruthRows` → 3 rows and `listUrgentNoticeTimes` → 2 rows, none of org A; with org A's `mailboxId` → `[]`.
5. `mailboxId` = org A's mailbox → the same results as `null` (one mailbox).
6. `testMail = { senders: [<e2's sender>] }` → e2 is gone from `listTruthRows` and `listUrgentNoticeTimes`.

**Check.** `bun test apps/server/test/integration/metrics-readers.test.ts`

**Done when.** Cases 1–6 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** The actions, delegation and audit readers (stage 11); combining the rows (stage 12).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s10`).
