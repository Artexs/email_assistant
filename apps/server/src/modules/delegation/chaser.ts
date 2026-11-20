import { randomUUID } from "node:crypto";

import {
  DAY_MS,
  draftLanguageSchema,
  dueDateOrNone,
  type DraftPayload,
  localDateTime,
  localKey,
  localToInstant,
  sendPayloadFor,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { createPlanned, getDraft } from "../actions";
import { auditEvents, countMailboxEventsBetween, recordAudit } from "../audit";
import { lockSettingsForShare } from "../config";
import { getEmailMeta } from "../mail";

import {
  countPendingReminderSends,
  isDelegateActive,
  listDueDelegations,
  lockDelegation,
  markDelegationOverdue,
  markReminderPlanned,
  MAX_REMINDER_SENDS,
} from "./repo";

const log = createLog("delegation");

export const CHASER_LOCAL_TIME = "07:30";
export const REMINDER_GAP_MS = 3 * DAY_MS;
export const MAX_REMINDERS = MAX_REMINDER_SENDS;
// The set request shows every item with its task within 4096 characters.
export const CHASER_SET_LIMIT = 10;
const DUE_BATCH = 200;

export interface ChaserDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

export function reminderDecision(
  row: {
    status: "sent" | "overdue";
    reminders_sent: number;
    last_reminder_at: Date | null;
    delegate_active: boolean;
  },
  pendingReminders: number,
  now: Date
): { markOverdue: boolean; remind: boolean } {
  return {
    markOverdue: row.status === "sent",
    remind:
      row.delegate_active &&
      pendingReminders === 0 &&
      row.reminders_sent < MAX_REMINDERS &&
      (row.last_reminder_at === null || now.getTime() - row.last_reminder_at.getTime() >= REMINDER_GAP_MS),
  };
}

export interface ChaserResult {
  overdue: number;
  reminders: number;
  skipped: "gate" | "settings" | null;
}

function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
}

// The References header holds ids separated by white space.
function splitReferences(header: string | null): string[] {
  return header === null ? [] : header.split(/\s+/).filter((id) => id !== "");
}

// The reminder draft of a delegation: the fixed template, the thread of the delegation mail and the delegate as the only
// recipient. The chaser and `remindNow` plan the same draft; `count` is the number of this reminder (`reminders_sent` + 1).
export async function buildReminderDraft(
  trx: Transaction<DB>,
  ctx: TenantContext,
  row: {
    id: string;
    email_id: string;
    delegate_id: string;
    draft_action_id: string;
    task_summary: string;
    sent_message_id: string | null;
    delegate_email: string;
    delegate_name: string;
  },
  count: number
): Promise<DraftPayload> {
  const email = await getEmailMeta(trx, ctx, row.email_id);
  const original = await getDraft(trx, ctx, row.draft_action_id);
  const language = draftLanguageSchema.safeParse(original?.payload.language);
  return {
    kind: "reminder",
    delegate_id: row.delegate_id,
    delegate_name: row.delegate_name,
    to: [row.delegate_email],
    task: row.task_summary,
    due_date: dueDateOrNone(original?.payload.due_date),
    language: language.success ? language.data : "en",
    delegation_id: row.id,
    reminder: count === 1 ? 1 : 2,
    thread: {
      in_reply_to: row.sent_message_id,
      references: uniqueIds([
        ...splitReferences(email?.references_header ?? null),
        email?.message_id_header,
        row.sent_message_id,
      ]),
    },
  };
}

// The day gate of the chaser (once per local day per mailbox). The run and the marker share one lock: `lockChaserDay`.
export function chaserDay(now: Date, timeZone: string): { day: string; after: Date } {
  const day = localKey(now, timeZone).slice(0, 10);
  const dayStart = localToInstant(day, "00:00", timeZone);
  return { day, after: new Date(dayStart.getTime() - 1) };
}

// True when the event of a part already ran in this local day of the mailbox.
export async function chaserRanToday(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { event: string; mailboxId: string; now: Date; timeZone: string }
): Promise<boolean> {
  const { after } = chaserDay(input.now, input.timeZone);
  return (await countMailboxEventsBetween(db, ctx, input.event, input.mailboxId, { after, until: input.now })) > 0;
}

// "Once per local day" is a rule of two connections too: the gate read before the transaction is only a cheap first look.
// Inside the transaction, after the settings share lock, one advisory lock per mailbox makes the runs wait one after the
// other; the run then reads the day marker again and sees the commit of the run that went first. Lock order: settings
// (share), this lock, the delegations / loops, their sends. Nobody takes this lock while it holds one of those rows.
export async function lockChaserDay(trx: Transaction<DB>, mailboxId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`chaser:${mailboxId}`}, 0))`.execute(trx);
}

type DueDelegationRow = Awaited<ReturnType<typeof listDueDelegations>>[number];

export interface PlannedReminder {
  row: DueDelegationRow;
  draft: DraftPayload;
}

export interface DelegationPlan {
  due: number;
  overdue: number;
  // At most `limit` pairs. The delegations are locked; the pairs are not yet written (`createReminderSet`).
  pairs: PlannedReminder[];
}

// The delegation part of the chaser, in the caller's transaction (the settings share lock is taken): lists the due
// delegations, locks each one (the delegation first, then its reminder sends), marks it overdue, and returns the reminder
// pairs that the rules allow, up to `limit`. Nothing is planned yet: the caller writes the set with `createReminderSet`.
export async function planDelegationReminders(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number }
): Promise<DelegationPlan> {
  const { now } = opts;
  const rows = await listDueDelegations(trx, ctx, mailboxId, { now, limit: DUE_BATCH });
  let overdue = 0;
  const pairs: PlannedReminder[] = [];
  for (const row of rows) {
    const locked = await lockDelegation(trx, ctx, row.id);
    if (locked === undefined || (locked.status !== "sent" && locked.status !== "overdue")) continue;
    // The listing may be old: a delegate deactivated since then gets no reminder.
    const delegateActive = await isDelegateActive(trx, ctx, row.delegate_id);
    const pending = await countPendingReminderSends(trx, ctx, row.id);
    const decision = reminderDecision(
      { ...locked, status: locked.status, delegate_active: delegateActive },
      pending,
      now
    );
    if (decision.markOverdue && (await markDelegationOverdue(trx, ctx, row.id, now))) {
      overdue += 1;
      await recordAudit(trx, ctx, {
        emailId: row.email_id,
        actor: "system",
        event: auditEvents.delegationOverdue,
        data: { delegation_id: row.id },
        at: now,
      });
    }
    if (!decision.remind || pairs.length >= opts.limit) continue;
    pairs.push({ row, draft: await buildReminderDraft(trx, ctx, row, locked.reminders_sent + 1) });
  }
  return { due: rows.length, overdue, pairs };
}

// The set creation: one `create_draft` and one `send` per planned reminder, all with the same `set_id`, then the reminder
// counters. A crash after the rows made the keys exist: the insert is a no-op and nothing counts. Returns the pairs written.
export async function createReminderSet(
  trx: Transaction<DB>,
  ctx: TenantContext,
  pairs: readonly PlannedReminder[],
  opts: { setId: string; day: string; now: Date }
): Promise<number> {
  let written = 0;
  for (const { row, draft } of pairs) {
    const created = await createPlanned(trx, ctx, row.email_id, [
      {
        type: "create_draft",
        payload: draft,
        status: "ready",
        idempotencyKey: `${row.email_id}:create_draft:reminder:${opts.day}`,
      },
      {
        type: "send",
        payload: { ...sendPayloadFor(draft), set_id: opts.setId },
        status: "awaiting_approval",
        idempotencyKey: `${row.email_id}:send:reminder:${opts.day}`,
        dependsOn: "create_draft",
      },
    ]);
    if (created.length === 0) continue;
    await markReminderPlanned(trx, ctx, row.id, opts.now);
    written += 1;
  }
  return written;
}

export interface DelegationRunCounts {
  mailboxId: string;
  due: number;
  overdue: number;
  reminders: number;
}

// The marker of the delegation part: the audit row `delegation.chaser_run` (counts and ids only).
export async function recordDelegationRun(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: DelegationRunCounts & { setId: string; forced: boolean; now: Date }
): Promise<void> {
  await recordAudit(trx, ctx, {
    actor: "system",
    event: auditEvents.delegationChaserRun,
    data: {
      mailbox_id: input.mailboxId,
      due: input.due,
      overdue: input.overdue,
      reminders: input.reminders,
      set_id: input.setId,
      forced: input.forced,
    },
    at: input.now,
  });
}

// The line `chaser_done` after the commit.
export function logDelegationRunDone(input: DelegationRunCounts): void {
  if (input.due === 0) return;
  log.info("chaser_done", {
    mailbox_id: input.mailboxId,
    due: input.due,
    overdue: input.overdue,
    reminders: input.reminders,
  });
}

// The delegation part alone, with its own gate: a thin wrapper of the parts above. `runLoopChaser` (module `loops`) runs the
// same parts in one transaction with the loop part. The snapshot `mailbox` is what the caller read before: the run writes
// nothing when the settings changed since.
export async function runChaserForMailbox(
  deps: ChaserDeps,
  ctx: TenantContext,
  mailbox: { id: string; timezone: string; settingsVersion: string },
  now: Date,
  opts?: { force?: boolean }
): Promise<ChaserResult> {
  const force = opts?.force === true;
  const tz = mailbox.timezone;
  const ran = (db: Db | Transaction<DB>): Promise<boolean> =>
    chaserRanToday(db, ctx, { event: auditEvents.delegationChaserRun, mailboxId: mailbox.id, now, timeZone: tz });
  if (!force) {
    if (localDateTime(now, tz).time < CHASER_LOCAL_TIME) return { overdue: 0, reminders: 0, skipped: "gate" };
    if (await ran(deps.db)) return { overdue: 0, reminders: 0, skipped: "gate" };
  }
  const { day } = chaserDay(now, tz);
  const setId = randomUUID();

  const run = async (trx: Transaction<DB>): Promise<ChaserResult & { due: number }> => {
    // The first statement of the transaction. A setter waits for this transaction, or this one sees the setter's commit.
    const version = await lockSettingsForShare(trx, ctx, mailbox.id);
    if (version === undefined || version !== mailbox.settingsVersion) {
      return { overdue: 0, reminders: 0, skipped: "settings", due: 0 };
    }
    await lockChaserDay(trx, mailbox.id);
    if (!force && (await ran(trx))) return { overdue: 0, reminders: 0, skipped: "gate", due: 0 };
    const plan = await planDelegationReminders(trx, ctx, mailbox.id, { now, limit: CHASER_SET_LIMIT });
    const reminders = await createReminderSet(trx, ctx, plan.pairs, { setId, day, now });
    await recordDelegationRun(trx, ctx, {
      mailboxId: mailbox.id,
      due: plan.due,
      overdue: plan.overdue,
      reminders,
      setId,
      forced: force,
      now,
    });
    return { overdue: plan.overdue, reminders, skipped: null, due: plan.due };
  };
  const { due, ...result } = deps.db.isTransaction
    ? await run(deps.db as Transaction<DB>)
    : await deps.db.transaction().execute(run);

  if (result.skipped === null) logDelegationRunDone({ mailboxId: mailbox.id, due, ...result });
  return result;
}
