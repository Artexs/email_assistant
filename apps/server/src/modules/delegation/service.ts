import {
  ADDRESS_PATTERN,
  DELEGATE_NAME_MAX,
  DELEGATE_TAG_MAX,
  DELEGATE_TAGS_MAX,
  localToInstant,
  normalizeAddress,
  storedAddressForm,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { expireReminderActions, reject, type ApprovalDeps, type DelegationHooks } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { listMailboxes, mailboxHasUidplus, normalizeMessageId } from "../mail";

import {
  bumpReminder,
  findDelegateIdByAddress,
  findOpenDelegationByMessageIds,
  getDelegate,
  getDelegation,
  insertDelegate,
  insertDelegation,
  lockDelegate,
  lockDelegation,
  markDelegationAnswered,
  markDelegationCancelled,
  markDelegationDone,
  markDelegationSent,
  moveDelegationToVersion,
  updateDelegateFields,
  USER_CANCELLED,
  type DelegationSource,
  type DelegationStatus,
} from "./repo";

type DbOrTrx = Db | Transaction<DB>;

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
  // not an address: a competence tag is free text
  const result = [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
  if (
    result.length > DELEGATE_TAGS_MAX ||
    result.some((tag) => tag === "" || Array.from(tag).length > DELEGATE_TAG_MAX)
  )
    return null;
  return result;
}

function cleanName(raw: string): string | null {
  const name = raw.trim();
  return name === "" || Array.from(name).length > DELEGATE_NAME_MAX ? null : name;
}

// A delegate's address is never a mailbox address of the organization (modules §3.3). The stored address is the lower case
// form that reminders go to; the one address rule is a compare key only.
export async function addDelegate(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { name: string; email: string; tags: string[]; actor: string; via: DelegateVia; now: Date }
): Promise<AddDelegateResult> {
  const name = cleanName(input.name);
  if (name === null) return { kind: "invalid", field: "name" };
  const email = storedAddressForm(input.email);
  if (!ADDRESS_PATTERN.test(email)) return { kind: "invalid", field: "email" };
  const tags = normalizeTags(input.tags);
  if (tags === null) return { kind: "invalid", field: "tags" };
  const mailboxes = await listMailboxes(db, ctx);
  if (mailboxes.some((mailbox) => normalizeAddress(mailbox.address) === normalizeAddress(email)))
    return { kind: "mailbox_address" };
  return inTransaction(db, async (trx): Promise<AddDelegateResult> => {
    // One person once, by the one rule, in any status. The unique index still guards two adds of the same form at once.
    if ((await findDelegateIdByAddress(trx, ctx, email)) !== undefined) return { kind: "exists" };
    const id = await insertDelegate(trx, ctx, { name, email, tags });
    if (id === null) return { kind: "exists" };
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.delegateAdded,
      data: { delegate_id: id, via: input.via },
      at: input.now,
    });
    return { kind: "added", id };
  });
}

export type DelegateVia = "web" | "cli";

export type UpdateDelegateResult =
  | { kind: "changed" | "same" | "not_found" }
  | { kind: "invalid"; field: "name" | "tags" };

// Name, tags and the active state. The address never changes. One audit row per call that changes something; it holds the
// names of the changed fields, never the old or the new value. A disabled delegate keeps its open delegations.
export async function updateDelegate(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { id: string; name?: string; tags?: string[]; active?: boolean; actor: string; via: DelegateVia; now: Date }
): Promise<UpdateDelegateResult> {
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name === null) return { kind: "invalid", field: "name" };
  const tags = input.tags === undefined ? undefined : normalizeTags(input.tags);
  if (tags === null) return { kind: "invalid", field: "tags" };
  return inTransaction(db, async (trx): Promise<UpdateDelegateResult> => {
    const current = await lockDelegate(trx, ctx, input.id);
    if (current === undefined) return { kind: "not_found" };
    const fields: string[] = [];
    const patch: { name?: string; tags?: string[]; active?: boolean } = {};
    if (name !== undefined && name !== current.name) {
      fields.push("name");
      patch.name = name;
    }
    if (
      tags !== undefined &&
      (tags.length !== current.competence_tags.length || tags.some((tag, i) => tag !== current.competence_tags[i]))
    ) {
      fields.push("tags");
      patch.tags = tags;
    }
    const activeChanged = input.active !== undefined && input.active !== current.active;
    if (activeChanged) {
      fields.push("active");
      patch.active = input.active;
    }
    if (fields.length === 0) return { kind: "same" };
    await updateDelegateFields(trx, ctx, input.id, patch, input.now);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.delegateChanged,
      data: {
        delegate_id: input.id,
        // Audit data is flat: the field names go in one string, in the order name, tags, active.
        fields: fields.join(","),
        ...(activeChanged ? { active: input.active } : {}),
        via: input.via,
      },
      at: input.now,
    });
    return { kind: "changed" };
  });
}

// The CLI switch: `updateDelegate` with the active state only.
export async function setDelegateState(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { id: string; active: boolean; actor: string; now: Date }
): Promise<"changed" | "same" | "not_found"> {
  const result = await updateDelegate(db, ctx, { ...input, via: "cli" });
  // No name or tags in the call: `invalid` cannot happen.
  return result.kind === "invalid" ? "same" : result.kind;
}

// An impossible calendar date gives null.
function dueInstant(dueDate: string | null, timezone: string): Date | null {
  if (dueDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const check = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== dueDate) return null;
  return localToInstant(dueDate, DUE_TIME, timezone);
}

// Runs in the caller's transaction (`saveTriage`); the caller then merges `delegation_id` into the two payloads.
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
    // The Delegate command sets all three; triage sets none: `source` is `triage` and the actor is the system.
    source?: DelegationSource;
    via?: "web" | "telegram" | "cli";
    actor?: string;
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
    ...(input.source === undefined ? {} : { source: input.source }),
  });
  await recordAudit(trx, ctx, {
    emailId: input.emailId,
    actionId: input.sendActionId,
    actor: input.actor ?? "system",
    event: auditEvents.delegationCreated,
    data: {
      delegation_id: id,
      delegate_id: input.delegateId,
      send_action_id: input.sendActionId,
      due: dueAt !== null,
      source: input.source ?? "triage",
      ...(input.via === undefined ? {} : { via: input.via }),
    },
    at: input.now,
  });
  return id;
}

// An open delegation of this mailbox whose delegate sent the mail, in a thread that the system started.
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

// The three closing functions lock the delegation first, then its reminder sends (the lock order).
async function closeReminders(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegation: { mailbox_id: string },
  delegationId: string,
  opts: { at: Date; actor: string }
): Promise<string[]> {
  const { sendIds } = await expireReminderActions(trx, ctx, delegationId, {
    now: opts.at,
    uidplus: await mailboxHasUidplus(trx, ctx, delegation.mailbox_id),
    actor: opts.actor,
  });
  return sendIds;
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
    data: { delegation_id: delegationId, delegate_id: delegation.delegate_id, reminders_expired: expired.length },
    at: input.at,
  });
  return true;
}

// The delegation is cancelled and its open reminder sends expire. The caller holds the transaction; this locks the delegation first,
// then its reminder sends (lock order: the delegation, then its sends). `reason` `user_cancelled` is the user's own cancel: it also takes `sent` and `overdue`
// (`markDelegationCancelled`), and the audit row names the user (`actor`) and the channel (`via`). `expiredSendIds` are the reminder sends
// that this call closed; a caller that edits their cards queues the edits.
async function cancelLocked(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { reason: string; at: Date; actor?: string; via?: string }
): Promise<{ cancelled: boolean; expiredSendIds: string[] }> {
  const delegation = await lockDelegation(trx, ctx, delegationId);
  if (delegation === undefined) return { cancelled: false, expiredSendIds: [] };
  if (!(await markDelegationCancelled(trx, ctx, delegationId, input))) return { cancelled: false, expiredSendIds: [] };
  const actor = input.actor ?? "system";
  const expired = await closeReminders(trx, ctx, delegation, delegationId, { at: input.at, actor });
  await recordAudit(trx, ctx, {
    emailId: delegation.email_id,
    actionId: delegation.send_action_id,
    actor,
    event: auditEvents.delegationCancelled,
    reasonCode: input.reason,
    data: {
      delegation_id: delegationId,
      delegate_id: delegation.delegate_id,
      reminders_expired: expired.length,
      ...(input.via === undefined ? {} : { reason: input.reason, via: input.via }),
    },
    at: input.at,
  });
  return { cancelled: true, expiredSendIds: expired };
}

export async function cancelDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { reason: string; at: Date; actor?: string; via?: string }
): Promise<boolean> {
  return (await cancelLocked(trx, ctx, delegationId, input)).cancelled;
}

export interface CancelByUserResult {
  kind: "cancelled" | "not_open" | "sending" | "not_found";
}

export interface CancelByUserDeps extends ApprovalDeps {
  // Test seam: runs after the delegation read of each attempt, before the cancel (a panel edit can come between them).
  afterRead?(delegationId: string): Promise<void>;
}

// The user cancels an open delegation. Status flow: `drafted`, `sent` or `overdue` -> `cancelled` /
// `user_cancelled`; the reason is final. Two ways, as the lock orders differ:
//   `drafted`: the waiting send is rejected (`reject`: lock the send, then the delegation), with the card hooks, so the Telegram cards
//     follow. A panel edit can replace the send between the read and the lock: `reject` answers `superseded`, and the call reads the
//     delegation again and tries once more with the current send. A send that already went out leaves a `sent` delegation: that
//     read takes the second way.
//   `sent` or `overdue`: lock the delegation, mark it cancelled, expire its waiting reminder sends (the existing reminder close), and
//     call `onDecided` with `expired` for each, so their cards lose the buttons (lock order: delegation, then its reminder sends).
// A send that is in flight (`applying`, or `approved` with a fresh lock) gives `sending`; the mail may reach the delegate.
export async function cancelByUser(
  deps: CancelByUserDeps,
  ctx: TenantContext,
  delegationId: string,
  input: { userId: string; via: "web" | "cli"; now: Date }
): Promise<CancelByUserResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const delegation = await getDelegation(deps.db, ctx, delegationId);
    if (delegation === undefined) return { kind: "not_found" };
    await deps.afterRead?.(delegationId);
    if (delegation.status === "drafted") {
      const result = await reject(deps, ctx, delegation.send_action_id, {
        userId: input.userId,
        via: input.via,
        now: input.now,
        delegationReason: USER_CANCELLED,
      });
      switch (result.kind) {
        case "rejected":
          return { kind: "cancelled" };
        case "not_found":
          return { kind: "not_found" };
        case "superseded":
          continue;
        case "already":
          if (result.status === "applied") continue;
          return { kind: result.status === "applying" || result.status === "approved" ? "sending" : "not_open" };
      }
    }
    return inTransaction(deps.db, async (trx): Promise<CancelByUserResult> => {
      const result = await cancelLocked(trx, ctx, delegationId, {
        reason: USER_CANCELLED,
        at: input.now,
        actor: input.userId,
        via: input.via,
      });
      if (!result.cancelled) return { kind: "not_open" };
      for (const sendId of result.expiredSendIds) {
        await deps.approvalHooks.onDecided(trx, ctx, { sendId, decision: "expired", at: input.now });
      }
      return { kind: "cancelled" };
    });
  }
  return { kind: "not_open" };
}

// `done` only from `answered` or `overdue`; `already` for `done`; `not_closable` for `drafted`, `sent` and `cancelled`.
export type CloseResult =
  | { kind: "done" }
  | { kind: "already" }
  | { kind: "not_closable"; status: DelegationStatus }
  | { kind: "not_found" };

export async function closeDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  input: { actor: string; at: Date; via?: "web" }
): Promise<CloseResult> {
  const delegation = await lockDelegation(trx, ctx, delegationId);
  if (delegation === undefined) return { kind: "not_found" };
  if (delegation.status === "done") return { kind: "already" };
  if (!(await markDelegationDone(trx, ctx, delegationId, input.at))) {
    return { kind: "not_closable", status: delegation.status };
  }
  const expired = await closeReminders(trx, ctx, delegation, delegationId, { at: input.at, actor: input.actor });
  await recordAudit(trx, ctx, {
    emailId: delegation.email_id,
    actor: input.actor,
    event: auditEvents.delegationDone,
    data: {
      delegation_id: delegationId,
      delegate_id: delegation.delegate_id,
      reminders_expired: expired.length,
      ...(input.via === undefined ? {} : { via: input.via }),
    },
    at: input.at,
  });
  return { kind: "done" };
}

// The callbacks that the committer, the approvals and the expiry job call. `main.ts` wires them.
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
    onWentOut: async (trx, ctx, input) => {
      const delegation = await lockDelegation(trx, ctx, input.delegationId);
      if (delegation === undefined) return "not_open";
      if (delegation.status !== "cancelled") {
        return delegation.sent_message_id === input.sentMessageId ? "already" : "not_open";
      }
      if (delegation.status_reason !== "outcome_unknown") return "not_open";
      const changed = await markDelegationSent(trx, ctx, input.delegationId, {
        sentMessageId: input.sentMessageId,
        sentAt: input.at,
        dueAtWhenNull: input.dueAtWhenNull,
      });
      if (!changed) return "not_open";
      await recordAudit(trx, ctx, {
        emailId: delegation.email_id,
        actionId: delegation.send_action_id,
        actor: input.actor,
        event: auditEvents.delegationSent,
        data: { delegation_id: input.delegationId, delegate_id: delegation.delegate_id, went_out: true },
        at: input.at,
      });
      return "changed";
    },
    onSuperseded: async (trx, ctx, input) => {
      const delegation = await lockDelegation(trx, ctx, input.delegationId);
      if (delegation === undefined) return false;
      return moveDelegationToVersion(trx, ctx, input.delegationId, {
        draftActionId: input.draftActionId,
        sendActionId: input.sendActionId,
        delegateId: input.delegateId,
        at: input.at,
      });
    },
    activeDelegate: async (trx, ctx, delegateId) => {
      const delegate = await getDelegate(trx, ctx, delegateId);
      return delegate?.active === true ? { id: delegate.id, name: delegate.name, email: delegate.email } : undefined;
    },
    isOpen: async (trx, ctx, delegationId, kind) => {
      const delegation = await lockDelegation(trx, ctx, delegationId);
      if (delegation === undefined) return false;
      if (kind === "reminder") return delegation.status === "sent" || delegation.status === "overdue";
      if (delegation.status === "drafted") return true;
      return (
        delegation.status === "cancelled" &&
        (delegation.status_reason === "outcome_unknown" || delegation.status_reason === "send_failed")
      );
    },
  };
}
