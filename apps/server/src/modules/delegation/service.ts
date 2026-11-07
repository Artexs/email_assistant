import { ADDRESS_PATTERN, localToInstant } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { expireReminderActions, type DelegationHooks } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { listMailboxes, mailboxHasUidplus, normalizeMessageId } from "../mail";

import {
  bumpReminder,
  findOpenDelegationByMessageIds,
  getDelegate,
  insertDelegate,
  insertDelegation,
  lockDelegation,
  markDelegationAnswered,
  markDelegationCancelled,
  markDelegationDone,
  markDelegationSent,
  setDelegateActive,
} from "./repo";

type DbOrTrx = Db | Transaction<DB>;

const NAME_MAX = 100;
const TAGS_MAX = 10;
const TAG_MAX = 30;
const DUE_TIME = "17:00";

export type AddDelegateResult =
  | { kind: "added"; id: string }
  | { kind: "exists" }
  | { kind: "mailbox_address" }
  | { kind: "invalid"; field: "name" | "email" | "tags" };

function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

function normalizeTags(tags: readonly string[]): string[] | null {
  const result = [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
  if (result.length > TAGS_MAX || result.some((tag) => tag === "" || Array.from(tag).length > TAG_MAX)) return null;
  return result;
}

// A delegate's address is never a mailbox address of the organization (modules §3.3).
export async function addDelegate(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { name: string; email: string; tags: string[]; actor: string; now: Date }
): Promise<AddDelegateResult> {
  const name = input.name.trim();
  if (name === "" || Array.from(name).length > NAME_MAX) return { kind: "invalid", field: "name" };
  const email = input.email.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(email)) return { kind: "invalid", field: "email" };
  const tags = normalizeTags(input.tags);
  if (tags === null) return { kind: "invalid", field: "tags" };
  const mailboxes = await listMailboxes(db, ctx);
  if (mailboxes.some((mailbox) => mailbox.address.toLowerCase() === email)) return { kind: "mailbox_address" };
  return inTransaction(db, async (trx): Promise<AddDelegateResult> => {
    const id = await insertDelegate(trx, ctx, { name, email, tags });
    if (id === null) return { kind: "exists" };
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.delegateAdded,
      data: { delegate_id: id },
      at: input.now,
    });
    return { kind: "added", id };
  });
}

export async function setDelegateState(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { id: string; active: boolean; actor: string; now: Date }
): Promise<"changed" | "same" | "not_found"> {
  return inTransaction(db, async (trx) => {
    if ((await getDelegate(trx, ctx, input.id)) === undefined) return "not_found";
    if (!(await setDelegateActive(trx, ctx, input.id, input.active, input.now))) return "same";
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.delegateChanged,
      data: { delegate_id: input.id, active: input.active },
      at: input.now,
    });
    return "changed";
  });
}

// An impossible calendar date gives null.
function dueInstant(dueDate: string | null, timezone: string): Date | null {
  if (dueDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const check = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== dueDate) return null;
  return localToInstant(dueDate, DUE_TIME, timezone);
}

// Runs in the caller's transaction (`saveTriage`); the caller then merges `delegation_id` into the two payloads (D2).
export async function createDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    mailboxId: string;
    emailId: string;
    delegateId: string;
    draftActionId: string;
    sendActionId: string;
    task: string;
    dueDate: string | null;
    timezone: string;
    now: Date;
  }
): Promise<string> {
  const dueAt = dueInstant(input.dueDate, input.timezone);
  const id = await insertDelegation(trx, ctx, {
    mailboxId: input.mailboxId,
    emailId: input.emailId,
    delegateId: input.delegateId,
    draftActionId: input.draftActionId,
    sendActionId: input.sendActionId,
    taskSummary: input.task,
    dueAt,
    createdAt: input.now,
  });
  await recordAudit(trx, ctx, {
    emailId: input.emailId,
    actionId: input.sendActionId,
    actor: "system",
    event: auditEvents.delegationCreated,
    data: { delegation_id: id, delegate_id: input.delegateId, send_action_id: input.sendActionId, due: dueAt !== null },
    at: input.now,
  });
  return id;
}

// D7: an open delegation of this mailbox whose delegate sent the mail, in a thread that the system started.
export async function detectReply(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  mail: { fromAddress: string | null; inReplyTo: string | null; referencesHeader: string | null }
): Promise<{ delegationId: string; delegateId: string } | null> {
  const ids = [mail.inReplyTo, ...(mail.referencesHeader?.split(/\s+/) ?? [])]
    .map((id) => normalizeMessageId(id))
    .filter((id): id is string => id !== null);
  if (ids.length === 0 || mail.fromAddress === null) return null;
  const found = await findOpenDelegationByMessageIds(db, ctx, mailboxId, ids, mail.fromAddress);
  return found ? { delegationId: found.id, delegateId: found.delegateId } : null;
}

// The three closing functions lock the delegation first, then its reminder sends (D6 lock order).
async function closeReminders(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegation: { mailbox_id: string },
  delegationId: string,
  opts: { at: Date; actor: string }
): Promise<number> {
  const { sends } = await expireReminderActions(trx, ctx, delegationId, {
    now: opts.at,
    uidplus: await mailboxHasUidplus(trx, ctx, delegation.mailbox_id),
    actor: opts.actor,
  });
  return sends;
}

export async function markAnswered(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { emailId: string; at: Date }
): Promise<boolean> {
  const delegation = await lockDelegation(trx, ctx, delegationId);
  if (delegation === undefined) return false;
  if (!(await markDelegationAnswered(trx, ctx, delegationId, { answeredEmailId: input.emailId, at: input.at }))) {
    return false;
  }
  const expired = await closeReminders(trx, ctx, delegation, delegationId, { at: input.at, actor: "system" });
  await recordAudit(trx, ctx, {
    emailId: input.emailId,
    actor: "system",
    event: auditEvents.delegationAnswered,
    data: { delegation_id: delegationId, delegate_id: delegation.delegate_id, reminders_expired: expired },
    at: input.at,
  });
  return true;
}

export async function cancelDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { reason: string; at: Date }
): Promise<boolean> {
  const delegation = await lockDelegation(trx, ctx, delegationId);
  if (delegation === undefined) return false;
  if (!(await markDelegationCancelled(trx, ctx, delegationId, input))) return false;
  const expired = await closeReminders(trx, ctx, delegation, delegationId, { at: input.at, actor: "system" });
  await recordAudit(trx, ctx, {
    emailId: delegation.email_id,
    actionId: delegation.send_action_id,
    actor: "system",
    event: auditEvents.delegationCancelled,
    reasonCode: input.reason,
    data: { delegation_id: delegationId, delegate_id: delegation.delegate_id, reminders_expired: expired },
    at: input.at,
  });
  return true;
}

export async function closeDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { actor: string; at: Date }
): Promise<"done" | "already" | "not_found"> {
  const delegation = await lockDelegation(trx, ctx, delegationId);
  if (delegation === undefined) return "not_found";
  if (!(await markDelegationDone(trx, ctx, delegationId, input.at))) return "already";
  const expired = await closeReminders(trx, ctx, delegation, delegationId, { at: input.at, actor: input.actor });
  await recordAudit(trx, ctx, {
    emailId: delegation.email_id,
    actor: input.actor,
    event: auditEvents.delegationDone,
    data: { delegation_id: delegationId, delegate_id: delegation.delegate_id, reminders_expired: expired },
    at: input.at,
  });
  return "done";
}

// The callbacks that the committer, the approvals and the expiry job call (D29). `main.ts` wires them.
export function delegationHooks(_deps: { db: Db }): DelegationHooks {
  return {
    onSent: async (trx, ctx, input) => {
      const delegation = await lockDelegation(trx, ctx, input.delegationId);
      if (delegation === undefined) return false;
      const changed = await markDelegationSent(trx, ctx, input.delegationId, {
        sentMessageId: input.sentMessageId,
        sentAt: input.sentAt,
        dueAtWhenNull: input.dueAtWhenNull,
      });
      if (!changed) return false;
      await recordAudit(trx, ctx, {
        emailId: delegation.email_id,
        actionId: delegation.send_action_id,
        actor: "system",
        event: auditEvents.delegationSent,
        data: { delegation_id: input.delegationId, delegate_id: delegation.delegate_id },
        at: input.sentAt,
      });
      return true;
    },
    onReminderSent: (trx, ctx, input) => bumpReminder(trx, ctx, input.delegationId, input.at),
    onCancelled: (trx, ctx, input) => cancelDelegation(trx, ctx, input.delegationId, input),
  };
}
