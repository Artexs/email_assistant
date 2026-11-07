import { randomUUID } from "node:crypto";

import {
  draftLanguageSchema,
  localDateTime,
  localKey,
  localToInstant,
  parseToolSwitches,
  sendPayloadFor,
  type DraftPayload,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { createPlanned, getDraft } from "../actions";
import { auditEvents, countMailboxEventsBetween, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import { getEmailMeta, listSyncTargets } from "../mail";
import { getOrganization } from "../tenancy";

import {
  countPendingReminderSends,
  isDelegateActive,
  listDueDelegations,
  lockDelegation,
  markDelegationOverdue,
  markReminderPlanned,
} from "./repo";

const log = createLog("delegation");

export const CHASER_LOCAL_TIME = "07:30";
export const REMINDER_GAP_MS = 3 * 24 * 3_600_000;
export const MAX_REMINDERS = 2;
// The set request shows every item with its task within 4096 characters (stage 14.2, review round 2 N25).
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

export async function runChaserForMailbox(
  deps: ChaserDeps,
  ctx: TenantContext,
  mailbox: { id: string; timezone: string; settingsVersion: string },
  now: Date,
  opts?: { force?: boolean }
): Promise<ChaserResult> {
  const force = opts?.force === true;
  const tz = mailbox.timezone;
  const day = localKey(now, tz).slice(0, 10);
  if (!force) {
    if (localDateTime(now, tz).time < CHASER_LOCAL_TIME) return { overdue: 0, reminders: 0, skipped: "gate" };
    const dayStart = localToInstant(day, "00:00", tz);
    const done = await countMailboxEventsBetween(deps.db, ctx, auditEvents.delegationChaserRun, mailbox.id, {
      after: new Date(dayStart.getTime() - 1),
      until: now,
    });
    if (done > 0) return { overdue: 0, reminders: 0, skipped: "gate" };
  }

  const rows = await listDueDelegations(deps.db, ctx, mailbox.id, { now, limit: DUE_BATCH });
  const setId = randomUUID();

  const run = async (trx: Transaction<DB>): Promise<ChaserResult> => {
    // M13: the first statement. A setter waits for this transaction, or this one sees the setter's commit.
    const version = await lockSettingsForShare(trx, ctx, mailbox.id);
    if (version === undefined || version !== mailbox.settingsVersion) {
      return { overdue: 0, reminders: 0, skipped: "settings" };
    }
    let overdue = 0;
    let reminders = 0;
    for (const row of rows) {
      // Lock order (D6): the delegation first, then its reminder sends.
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
      if (!decision.remind || reminders >= CHASER_SET_LIMIT) continue;

      const n = locked.reminders_sent + 1;
      const email = await getEmailMeta(trx, ctx, row.email_id);
      const original = await getDraft(trx, ctx, row.draft_action_id);
      const language = draftLanguageSchema.safeParse(original?.payload.language);
      const dueDate = original?.payload.due_date;
      const draft: DraftPayload = {
        kind: "reminder",
        delegate_id: row.delegate_id,
        delegate_name: row.delegate_name,
        to: [row.delegate_email],
        task: row.task_summary,
        due_date: typeof dueDate === "string" ? dueDate : "",
        language: language.success ? language.data : "en",
        delegation_id: row.id,
        reminder: n === 1 ? 1 : 2,
        thread: {
          in_reply_to: row.sent_message_id,
          references: uniqueIds([
            ...splitReferences(email?.references_header ?? null),
            email?.message_id_header,
            row.sent_message_id,
          ]),
        },
      };
      const created = await createPlanned(trx, ctx, row.email_id, [
        {
          type: "create_draft",
          payload: draft,
          status: "ready",
          idempotencyKey: `${row.email_id}:create_draft:reminder:${day}`,
        },
        {
          type: "send",
          payload: { ...sendPayloadFor(draft), set_id: setId },
          status: "awaiting_approval",
          idempotencyKey: `${row.email_id}:send:reminder:${day}`,
          dependsOn: "create_draft",
        },
      ]);
      // A crash after the rows made the keys exist: the insert is a no-op and nothing counts.
      if (created.length === 0) continue;
      await markReminderPlanned(trx, ctx, row.id, now);
      reminders += 1;
    }
    await recordAudit(trx, ctx, {
      actor: "system",
      event: auditEvents.delegationChaserRun,
      data: { mailbox_id: mailbox.id, due: rows.length, overdue, reminders, set_id: setId, forced: force },
      at: now,
    });
    return { overdue, reminders, skipped: null };
  };
  const result = deps.db.isTransaction
    ? await run(deps.db as Transaction<DB>)
    : await deps.db.transaction().execute(run);

  if (rows.length > 0 && result.skipped === null) {
    log.info(`chaser ${mailbox.id}: due ${rows.length}, overdue ${result.overdue}, reminders ${result.reminders}`);
  }
  return result;
}

export function createChaserJob(deps: ChaserDeps): { run(opts?: { force?: boolean }): Promise<void> } {
  const warnedSettings = new Set<string>();

  return {
    async run(opts) {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        try {
          const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
          const switches = settings && parseToolSwitches(settings.tool_switches);
          if (!settings || !switches || settings.mode !== "assist" || !switches.create_draft) {
            if (!warnedSettings.has(mailboxId)) {
              warnedSettings.add(mailboxId);
              log.info(`chaser ${mailboxId}: skipped settings`);
            }
            continue;
          }
          const organization = await getOrganization(deps.db, ctx);
          if (!organization) continue;
          if (opts?.force === true) log.info(`chaser ${mailboxId}: forced`);
          const mailbox = { id: mailboxId, timezone: organization.timezone, settingsVersion: settings.version };
          await runChaserForMailbox(deps, ctx, mailbox, deps.now(), opts);
        } catch (error) {
          log.error(`chaser ${mailboxId} failed: ${describeError(error)}`);
        }
      }
    },
  };
}
