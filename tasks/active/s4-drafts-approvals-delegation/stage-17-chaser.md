# s4-drafts-approvals-delegation — Stage 17

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 17 — `delegation.chaser`: overdue, reminder pairs, sets, the daily gate [risky]

Why risky: the chaser plans mail to people on a clock. It must run once per day, never double a reminder, and never remind an inactive delegate or an answered delegation.

- [ ] **17.1 `createChaserJob` (D21, D23, P4)**
  - Goal: once per mailbox per local day at or after 07:30, every due delegation becomes `overdue` and gets at most one new reminder pair, all reminders of the run in one approval set; a closed delegation never gets one.
  - Files: create `apps/server/src/modules/delegation/chaser.ts`, `apps/server/test/integration/delegation-chaser.test.ts`; change `apps/server/src/modules/delegation/index.ts`, `apps/server/src/modules/audit/repo.ts` (`countMailboxEventsBetween(db, ctx, event, mailboxId, range)`: as `countEventsBetween` with `data->>'mailbox_id' = mailboxId`), `audit/index.ts`.
  - Interfaces:

    ```ts
    export const CHASER_LOCAL_TIME = "07:30";
    export const REMINDER_GAP_MS = 3 * 24 * 3_600_000;
    export const MAX_REMINDERS = 2;
    export const CHASER_SET_LIMIT = 10; // the set request shows every item with its task within 4096 characters (stage 14.2, review round 2 N25)
    export interface ChaserDeps {
      db;
      now(): Date;
    }
    export function createChaserJob(deps: ChaserDeps): { run(opts?: { force?: boolean }): Promise<void> };
    export function reminderDecision(
      row: {
        status: "sent" | "overdue";
        reminders_sent: number;
        last_reminder_at: Date | null;
        delegate_active: boolean;
      },
      pendingReminders: number,
      now: Date
    ): { markOverdue: boolean; remind: boolean }; // pure, exported for tests
    export async function runChaserForMailbox(
      deps: ChaserDeps,
      ctx,
      mailbox: { id: string; timezone: string },
      now: Date,
      opts?: { force?: boolean }
    ): Promise<{ overdue: number; reminders: number; skipped: "gate" | "settings" | null }>;
    ```

  - Decisions:
    - `run({ force })`: `listSyncTargets(db)` (active mailboxes); per mailbox: `settings = getMailboxSettings` (none, `mode !== "assist"`, or `create_draft` off → `skipped: "settings"`); `organization = getOrganization` (timezone); the gate, unless `force`: `localDateTime(now, timezone).time >= CHASER_LOCAL_TIME` and `countMailboxEventsBetween(db, ctx, "delegation.chaser_run", mailboxId, { after: localToInstant(localKey(now, tz).slice(0, 10), "00:00", tz) − 1 ms, until: now }) === 0` (the local day of `now`; `localKey` / `localToInstant` of `core/digest/local-time.ts`), else `skipped: "gate"`. `force` (the `job:run --force` flag, stage 18) skips the time and the day marker; the pending-reminder rule and the 3-day gap still hold, so a forced run can never double a reminder. One mailbox's error never stops the next.
    - `runChaserForMailbox`: `rows = listDueDelegations(db, ctx, mailboxId, { now, limit: 200 })`; `setId = randomUUID()`; one transaction: for each row `locked = lockDelegation(trx, ctx, row.id)` (`FOR UPDATE`) and the status re-read: not `sent | overdue` any more (a reply was triaged a moment ago, or the user closed it) → skip (reviewer finding 7); `pending = countPendingReminderSends(trx, ctx, row.id)`; `decision = reminderDecision(locked, pending, now)`; `markOverdue` → `markDelegationOverdue` + audit `delegation.overdue`; `remind` (only while the set holds fewer than `CHASER_SET_LIMIT` reminders; the rest wait for the next day) → `n = locked.reminders_sent + 1`; the original mail (`getEmailMeta(row.email_id)`: `message_id_header`, `references_header`, `subject`); the original draft (`getDraft(row.draft_action_id)`: its payload gives `language` and `due_date`); `thread = { in_reply_to: row.sent_message_id, references: [...originalReferences, originalMessageId, row.sent_message_id].filter(Boolean, unique) }`; `draft = { kind: "reminder", delegate_id, delegate_name, to: [delegate_email], task: row.task_summary, due_date: <the original draft's due_date, "" when it had none: the delegate never reads a date nobody set>, language: <the original draft's language, "en" when missing>, delegation_id: row.id, reminder: n, thread }`; `day = localKey(now, tz).slice(0, 10)`; `createPlanned(trx, ctx, row.email_id, [{ type: "create_draft", payload: draft, status: "ready", idempotencyKey: `${emailId}:create_draft:reminder:${day}`}, { type: "send", payload: { ...sendPayloadFor(draft), set_id: setId }, status: "awaiting_approval", idempotencyKey:`${emailId}:send:reminder:${day}`, dependsOn: "create_draft" }])` (one reminder per delegation per local day; a crash after the rows makes the next run's insert a no-op: an empty result counts as not created); then `markReminderPlanned(trx, ctx, row.id, now)` (**`last_reminder_at` moves at planning**, so a rejected or expired reminder still keeps the 3-day gap; `reminders_sent` moves when the reminder send is `applied`, D11). Then audit `delegation.chaser_run` (`data: { mailbox_id, due: rows.length, overdue, reminders, set_id, forced }`) in the same transaction — the marker of the local day (written on every gated run, also with 0 due rows; a forced run writes it too, with `forced: true`).
    - `reminderDecision`: `markOverdue` = `status === "sent"`; `remind` = `delegate_active && pendingReminders === 0 && reminders_sent < MAX_REMINDERS && (last_reminder_at === null || now − last_reminder_at >= REMINDER_GAP_MS)`.
    - The `delegation` module imports `actions` (`createPlanned`, `getDraft`), `mail` (`getEmailMeta`, stage 7), `config`, `tenancy`, `audit` (D29). It runs no mailbox or SMTP call.
    - Log: `chaser <mailboxId>: due <n>, overdue <o>, reminders <r>` when `n > 0`; `chaser <mailboxId>: skipped settings` once per process per mailbox (`warnedSettings` set); `chaser <mailboxId>: forced` when `force`.
  - Test (`delegation-chaser.test.ts`, `withRollback`, `pauseOtherMailboxes`, fixtures; `Europe/Warsaw`; a mailbox in `assist` with `create_draft` on; delegations through `insertDelegation` with `status: "sent"`, `sent_message_id`, `due_at` yesterday 17:00; the original draft row with a payload `language: "pl"`, `due_date: "2026-11-09"`): (1) `now` = 2026-11-10T06:29Z (07:29 Warsaw) → `skipped: "gate"`, nothing changes; (2) `now` = 06:30Z (07:30) → the delegation `overdue`, audit `delegation.overdue`, a reminder draft `ready` with the payload (`reminder` 1, `thread.in_reply_to` = `sent_message_id`, `references` with the original id and the sent id, `due_date` `2026-11-09`, `language` `pl`) and a send `awaiting_approval` with `set_id` and `depends_on_action_id`, keys `…:reminder:2026-11-10`, `last_reminder_at` = now, audit `delegation.chaser_run`; (3) a second run at 06:45Z → `skipped: "gate"` (the day marker); with `force` → runs, no new pair (`pending` 1), the marker written again with `forced: true`; (4) the next day 06:30Z with the reminder send still `awaiting_approval` → no second reminder (`pending` 1), the day marker written; (5) the reminder applied (the fixture sets `reminders_sent` 1, `last_reminder_at` 2 days ago, no pending send) → no reminder (the gap); 3 days ago → reminder 2 with the key of that day; `reminders_sent` 2 → no reminder, the delegation stays `overdue`; (5b) the first reminder `rejected` (`last_reminder_at` set at planning 1 day ago, `reminders_sent` 0, no pending send) → no reminder (the gap holds after a reject); 3 days later → a new pair with the new day key; (6) an inactive delegate → `overdue` set, no reminder; (7) a `drafted` or `answered` delegation with a past `due_at` → untouched (not listed); (7b) a delegation listed as `sent` but set to `answered` by another transaction before the lock → skipped, no pair; (8) `shadow` mode or the switch off → `skipped: "settings"`, nothing changes; (9) two due delegations in one run → two pairs with the same `set_id`; 15 due → 10 reminders and 15 `overdue` (the other 5 get theirs on the next local day); (10) idempotency: a run whose `createPlanned` returns `[]` (the keys exist from a fixture) still writes the day marker and counts 0 reminders; (11) `reminderDecision` unit rows; (12) tenant: org B's rows untouched; (13) DST: `now` = 2026-03-29T05:30Z (07:30 CEST on the switch day) → runs; the day window uses the local day; (14) an original draft without `due_date` → the reminder payload has `due_date` `""`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the schedule (stage 18), the set approval (stages 15, 16).
