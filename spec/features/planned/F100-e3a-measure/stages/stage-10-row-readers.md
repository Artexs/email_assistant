# F100 stage 10 — Row readers

Part of [`../plan.md`](../plan.md). Review job before the land (tenant filters on many joins).

**Wait:** stages 04 and 09 of this ticket and F097 stages 01 (`TestMailRule`, `mailKindFilter(kind, rule)`) and 03 (source `review`) must be on `master`. Check: `grep -n "export function mailKindFilter" apps/server/src/modules/mail/repo/emails.ts` shows a rule parameter, and `feedbackSources` holds `"review"`. If not, stop and say so.

After this stage each module that owns a table has one reader that returns the stage 08–09 rows for one organization, one week and one or all mailboxes. One shared test fixture seeds a known week; later stages assert on it.

## Step 1 — The week fixture

**Goal.** One seeded week with known answers (used by stages 10, 11, 14).

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

Use `createOrgWithMailbox`, `insertTestEmail`, and the repository insert functions of each module (or plain Kysely inserts in the fixture; the fixture is test code). Rows must pass the table CHECKs: a `send` with status `applied` needs `approved_at`; a delegation in `sent`, `answered` or `overdue` needs `sent_message_id` and `sent_at`; a send needs its `create_draft` row as `depends_on_action_id` if the existing fixtures build it that way (copy the shape from `actions-approvals.test.ts` and `delegation-repo.test.ts`). Organization A: time zone `Europe/Warsaw`, one mailbox in `assist` mode. Times are UTC.

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

Plus 10 `llm.call` audit rows of org A (`mailbox_id` = A's mailbox, model `gpt-6-luna`, 1,036 in, 80 out) at 2026-11-17T10:00Z and one at 2026-11-10T10:00Z. Organization B: one mailbox, two mails received 2026-11-17 triaged `urgent` with `sent` urgent outbox rows, one `llm.call` row in the week, one `move` `applied` in the week.

**Decisions.** D11–D16, D18.

**Test.** The readers' tests below use it.

**Check.** `bun run typecheck`

**Done when.** The file compiles; the readers' tests use it.

**Out of scope.** The service (stage 11).

## Step 2 — Readers

**Goal.** One reader per owner module (D19), each filtering `org_id` on every table it joins, real mail only (D18).

**Files.** `apps/server/src/modules/triage/metrics-repo.ts` (new; `triage/repo.ts` is over 400 lines), `apps/server/src/modules/actions/repo/metrics.ts` (new) + `actions/repo/index.ts`, `apps/server/src/modules/delegation/metrics-repo.ts` (new), `apps/server/src/modules/audit/repo.ts` or `audit/metrics-repo.ts` (new), `apps/server/src/modules/channels/metrics-repo.ts` (new), each module's `index.ts`, `apps/server/test/integration/metrics-readers.test.ts` (new).

**Interfaces.** Every reader takes `(db: DbOrTrx, ctx: TenantContext, q: WeekQuery)` with

```ts
export interface WeekQuery {
  range: { start: Date; end: Date };
  mailboxId: string | null; // null = every mailbox of the organization
  testMail: TestMailRule; // from F097 stage 01
}
```

| Reader (module) | Returns | Rows |
| --- | --- | --- |
| `listTruthRows` (triage) | `MailTruthRow[]` | real mail, `received_at` in range, with a triage result; `predicted` = latest result (`DISTINCT ON (email_id) ORDER BY created_at DESC, id DESC`); latest feedback row (same order) → `truth = true_category`, `truthSource = truthSourceOf(source)`, `wrongOnly = verdict = 'wrong' AND true_category IS NULL` |
| `listHandledRows` (triage) | `HandledRow[]` | the same mail set; booleans by `EXISTS` on `actions` (original rows: `reverses_action_id IS NULL`; `type IN ('move','mark_read','flag')` by status `applied`, `undone`, `logged`; a `send` with `payload->>'kind' = 'delegation'` `applied`), `triage_feedback` (`verdict = 'wrong'` and `created_at ≤ latest result created_at + 7 days`), `delegations` (the newest of the mail has status `cancelled`) |
| `listHiddenMoveRows` (actions) | `(Omit<HiddenMoveRow, "whitelisted"> & { fromAddress: string \| null })[]` | original `move` actions with status `applied` or `undone`, `applied_at` in range, `payload->>'folder'` a move target other than `inbox` (parse with `isMoveTarget`; skip other values), of real mail; `vip` from the latest triage result; `truth` from the latest feedback |
| `listRejectRows` (actions) | `RejectRow[]` | `send` actions with status `rejected` whose first `action.rejected` audit row is in range; `reason` from `action_feedback` (`kind = 'reject_reason'`) or null |
| `listMistakeRows` (actions) | `MistakeRow[]` | `action_feedback` `kind = 'mistake'` joined to its `send` with status `applied` and `applied_at` in range (`sentAt = applied_at`) |
| `listDelegationDueRows` (delegation) | `DelegationDueRow[]` | delegations with `sent_at` not null and `COALESCE(due_at, sent_at + interval '3 days')` in range, of real mail; `doneAt`, `overdueAt` = `MIN(audit_log.created_at)` of `delegation.done` / `delegation.overdue` with `data->>'delegation_id' = d.id::text`; `cancelled = status = 'cancelled'` |
| `listLlmCallRows` (audit) | `LlmCallRow[]` | `event = 'llm.call'`, `created_at` in range, `data->>'mailbox_id'` = the mailbox when set; `model`, `tokens_in`, `tokens_out` from `data` (numbers or null) |
| `listUrgentNoticeTimes` (channels) | `UrgentNoticeRow[]` | real mail with `backfilled_at IS NULL`, `received_at` in range, latest triage category `urgent`; `noticeAt` = `MIN(outbox.sent_at)` of `kind = 'urgent'`, `status = 'sent'` rows of the mail |

Range rule: `start ≤ t < end` everywhere. `mailboxId` set → `emails.mailbox_id = $id` (for `listLlmCallRows`: the `data` key). The readers return no subject, no text; `fromAddress` leaves `listHiddenMoveRows` only for the whitelist check in the service and never reaches a log or a result.

**Decisions.** D11–D16, D18, D19.

**Test** (integration, `metrics-readers.test.ts`, `seedWeek` in `withRollback`, `range = weekRange(WEEK, "Europe/Warsaw")`, org A's context, `mailboxId: null`, `testMail = { senders: [] }`):

1. `listTruthRows` → 9 rows (e1–e7, e10, e13; not e8 synthetic, not e9, e11, e12 of other weeks); e1 `{ predicted: "info", truth: "urgent", truthSource: "correction" }`; e3 `{ truth: "needs_reply", truthSource: "review" }`.
2. `listHandledRows` → the same 9 mails; e1 `mailboxActionApplied: true, wrongWithin7Days: true`; e4 applied; e5 applied; e7 `delegationSendApplied: true, delegationCancelled: false`.
3. `listHiddenMoveRows` → e1 (`ai_info`, truth `urgent`), e4 (`ai_notifications`), e5 (`ai_spam`, `vip: true`); not e9.
4. `listRejectRows` → s1 `wrong_person` at 2026-11-18T13:00Z, s2 reason null.
5. `listMistakeRows` → s3 with `sentAt` 2026-11-20T09:10Z.
6. `listDelegationDueRows` → d2 (answered 2026-11-18T15:00Z) and d3 (`overdueAt` 2026-11-20T06:30Z); not e7's delegation (due 2026-11-23).
7. `listLlmCallRows` → 10 rows.
8. `listUrgentNoticeTimes` → e2 (`noticeAt` 10:03Z), e6 (`noticeAt` 2026-11-20T06:00Z), e10 (null); not e8.
9. Tenants: every reader in org B's context returns only org B's rows (2 truth rows, 1 llm row, 2 urgent rows), and with org A's `mailboxId` returns `[]`.
10. `mailboxId` = org A's mailbox → the same results as `null` (one mailbox).
11. `testMail = { senders: [<e2's sender>] }` → e2 is gone from `listTruthRows` and `listUrgentNoticeTimes`.

**Check.** `bun test apps/server/test/integration/metrics-readers.test.ts`

**Done when.** Cases 1–11 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** Combining the rows (stage 11).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s10`).
