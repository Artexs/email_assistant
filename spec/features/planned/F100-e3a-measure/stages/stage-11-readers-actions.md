# F100 stage 11 — Row readers II: actions, delegation and audit readers

Part of [`../plan.md`](../plan.md). Review job before the land (tenant filters on many joins). Needs stage 10 on `master` (the fixture and `WeekQuery`).

After this stage the readers of `actions` (M3), `delegation` (M2) and `audit` (M7) return the stage 08–09 rows for one organization, one week and one or all mailboxes, tested on the stage 10 fixture.

## Step 1 — Readers

**Goal.** One reader per owner module (D19), each filtering `org_id` on every table it joins, real mail only (D18; `listLlmCallRows` counts every call, D16).

**Files.** `apps/server/src/modules/actions/repo/metrics.ts` (new) + `actions/repo/index.ts`, `apps/server/src/modules/delegation/metrics-repo.ts` (new), `apps/server/src/modules/audit/metrics-repo.ts` (new), each module's `index.ts`, `apps/server/test/integration/metrics-readers-2.test.ts` (new).

**Interfaces.** Every reader takes `(db: DbOrTrx, ctx: TenantContext, q: WeekQuery)` (stage 10); `listLlmCallRows` takes `Omit<WeekQuery, "testMail">`.

| Reader (module) | Returns | Rows |
| --- | --- | --- |
| `listHiddenMoveRows` (actions) | `(Omit<HiddenMoveRow, "whitelisted"> & { mailboxId: string; fromAddress: string \| null })[]` | original `move` actions with status `applied` or `undone`, `applied_at` in range, `payload->>'folder'` a move target other than `inbox` (parse with `isMoveTarget`; skip other values), of real mail; `vip` from the latest triage result; `truth` from the latest feedback |
| `listRejectRows` (actions) | `RejectRow[]` | `send` actions with status `rejected` whose first `action.rejected` audit row is in range; `reason` from `action_feedback` (`kind = 'reject_reason'`) or null |
| `listMistakeRows` (actions) | `MistakeRow[]` | `action_feedback` `kind = 'mistake'` joined to its `send` with status `applied` and `applied_at` in range (`sentAt = applied_at`) |
| `listDelegationDueRows` (delegation) | `DelegationDueRow[]` | delegations with `sent_at` not null and `COALESCE(due_at, sent_at + interval '3 days')` in range, of real mail; `doneAt`, `overdueAt` = `MIN(audit_log.created_at)` of `delegation.done` / `delegation.overdue` with `data->>'delegation_id' = d.id::text`; `cancelled = status = 'cancelled'` |
| `listLlmCallRows` (audit) | `LlmCallRow[]` | `event = 'llm.call'`, `created_at` in range, `data->>'mailbox_id'` = the mailbox when set; `model`, `tokens_in`, `tokens_out` from `data` (numbers or null) |

Range rule: `start ≤ t < end` everywhere. `mailboxId` set → `emails.mailbox_id = $id` (for `listLlmCallRows`: the `data->>'mailbox_id'` key). The readers return no subject and no text; `fromAddress` leaves `listHiddenMoveRows` only for the whitelist check in the service and never reaches a log or a result.

**Decisions.** D12, D13, D16, D18, D19.

**Test** (integration, `metrics-readers-2.test.ts`, `seedWeek` in `withRollback`, the stage 10 setup):

1. `listHiddenMoveRows` → e1 (`ai_info`, truth `urgent`), e4 (`ai_notifications`), e5 (`ai_spam`, `vip: true`), each with org A's `mailboxId`; not e9.
2. `listRejectRows` → s1 `wrong_person` at 2026-11-18T13:00Z, s2 reason null.
3. `listMistakeRows` → s3 with `sentAt` 2026-11-20T09:10Z.
4. `listDelegationDueRows` → d2 (answered 2026-11-18T15:00Z) and d3 (`overdueAt` 2026-11-20T06:30Z); not e7's delegation (due 2026-11-23).
5. `listLlmCallRows` → 10 rows.
6. Tenants: in org B's context `listHiddenMoveRows` → 1 row (org B's move), `listLlmCallRows` → 1 row, the others `[]`; with org A's `mailboxId` → `[]`.
7. `mailboxId` = org A's mailbox → the same results as `null`.

**Check.** `bun test apps/server/test/integration/metrics-readers-2.test.ts`

**Done when.** Cases 1–7 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** Combining the rows (stage 12).

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f100-s11`).
