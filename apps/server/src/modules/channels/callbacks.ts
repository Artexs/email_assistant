import {
  categoryLabels,
  categoryTag,
  cleanSubject,
  encodeCallback,
  isFeedbackCallback,
  labelCategories,
  parseCallback,
  approvalEdit,
  formatClock,
  type ApprovalEditOutcome,
  type Callback,
  type Category,
  type FeedbackCallback,
  type OutMessage,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import {
  approve,
  approveSet,
  getSend,
  reject,
  rejectSet,
  sendAgain,
  sendFilterFor,
  sendScopeAdmits,
  undo,
  type ActionsScope,
  type ApprovalDeps,
  type DelegationHooks,
  type SendScope,
  type UndoResult,
} from "../actions";
import { closeDelegation } from "../delegation";
import { getMailbox } from "../mail";
import { getOrganization } from "../tenancy";
import { getLabelTarget, recordFeedback } from "../triage";

import type { CallbackResult, LinkedChat } from "./port";
import { findOutboxByDedup } from "./repo";

const log = createLog("channels");

export interface CallbackDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  actionsScope: ActionsScope;
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  sendScope: SendScope;
}

export const UNDO_TEXTS: Record<Exclude<UndoResult["kind"], "not_found">, string> = {
  started: "↩️ Undo started: the mail goes back within a minute.",
  already: "Undo was already requested for this mail.",
  nothing: "Nothing to undo.",
  too_old: "Too old to undo (7 days).",
  held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
};

export const APPROVAL_TEXTS = {
  owner_only: "Only an owner can approve or reject a send.",
  approved: "⏳ Sending within a minute.",
  approved_held: "Approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
  approved_paused: "Approved. The mailbox is paused, so the send waits; /status shows it.",
  approved_auth_error:
    "Approved. The mailbox login fails, so the send waits until the password is fixed; /status shows it.",
  already_approved: (clock: string) => `Already approved ${clock}.`,
  sending: "Already approved, sending now.",
  sent: "Already sent.",
  rejected: "This send was rejected.",
  expired: "This approval expired (48 h). The mail was not sent.",
  failed: "This send failed. See the result notice.",
  draft_not_ready: "The draft is not in Drafts yet. Tap again in a minute.",
  rejected_now: "✖️ Rejected. The draft will be removed.",
  not_found: "This mail is not in your account.", // the S2 text
  send_again: "⏳ A new send was approved. Sending within a minute.",
  send_again_held: {
    scope: "A new send was approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
    paused: "A new send was approved. The mailbox is paused, so the send waits; /status shows it.",
    auth_error: "A new send was approved. The mailbox login fails, so the send waits; /status shows it.",
  },
  held_notes: {
    scope: "Sending is held by SEND_SCOPE on the server",
    paused: "The mailbox is paused, so the sends wait",
    auth_error: "The mailbox login fails, so the sends wait",
  },
  send_again_already: "A resend was already approved for this mail.",
  send_again_not_failed: "This send is not in a failed state.",
  send_again_draft_gone: "The draft is gone: the mail must be triaged again.",
  set_nothing: "Nothing to approve: the reminders were handled already.",
  done: "✅ Done.",
  done_already: "Already done.",
  done_not_closable: "This delegation is not answered yet.",
  send_again_delegation_closed: "The delegation is closed: no resend.",
};

const NOT_FOUND_TEXT = APPROVAL_TEXTS.not_found;

const label = (category: Category): string => categoryLabels[category].name;

export function pickerMessage(emailId: string, subject: string | null, current: Category): OutMessage {
  const pick = (category: (typeof labelCategories)[number]) => ({
    text: categoryTag(category),
    data: encodeCallback({ kind: "pick", category, emailId }),
  });
  return {
    text: `✏️ Pick the right category\n${cleanSubject(subject)}\nAI said: ${categoryTag(current)}`,
    buttons: [
      [pick("urgent"), pick("needs_reply")],
      [pick("info"), pick("notification")],
      [pick("spam"), { text: "✖️ Cancel", data: encodeCallback({ kind: "cancel", emailId }) }],
    ],
  };
}

// The tenant comes from the link. An unknown mail id and a mail of another organization give the same answer.
export async function handleCallback(deps: CallbackDeps, link: LinkedChat, data: string): Promise<CallbackResult> {
  const callback = parseCallback(data);
  if (callback === null) return { answer: "This button is not valid any more." };
  const ctx = { orgId: link.orgId, userId: link.userId };
  if (!isFeedbackCallback(callback)) return handleApprovalCallback(deps, link, ctx, callback);
  if (callback.kind === "cancel") {
    return { answer: "", edit: { text: "✏️ Cancelled.", buttons: [] } };
  }
  const target = await getLabelTarget(deps.db, ctx, callback.emailId);
  if (!target) {
    return { answer: NOT_FOUND_TEXT };
  }
  if (callback.kind === "undo") {
    // One transaction: a feedback failure rolls back the reverse rows, so the user can tap again.
    const run = async (trx: Transaction<DB>) => {
      const undone = await undo(trx, ctx, callback.emailId, {
        now: deps.now(),
        userId: link.userId,
        scope: deps.actionsScope,
      });
      // keepLabel: a ✏️ label with a true category stays the latest feedback row. An unsure mail has no wrong category to record.
      if (undone.kind === "started" && target.category !== "unsure") {
        await recordFeedback(trx, ctx, {
          emailId: callback.emailId,
          verdict: "wrong",
          source: "undo",
          userId: link.userId,
          skipIfSame: true,
          keepLabel: true,
        });
      }
      return undone;
    };
    const result = await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
    if (result.kind === "not_found") return { answer: NOT_FOUND_TEXT };
    return { answer: UNDO_TEXTS[result.kind] };
  }
  if (callback.kind === "edit") {
    return { answer: "", send: pickerMessage(callback.emailId, target.subject, target.category) };
  }
  const saved = await recordFeedback(deps.db, ctx, {
    emailId: callback.emailId,
    trueCategory: callback.category,
    source: "telegram",
    userId: link.userId,
    skipIfSame: true,
  });
  if (callback.kind === "right") {
    return { answer: saved.saved ? `✅ Saved: ${label(callback.category)} is right.` : "Already saved." };
  }
  return {
    answer: saved.saved ? "Saved." : "Already saved.",
    edit: { text: `✏️ Saved: ${label(callback.category)} (AI said ${label(target.category)}).`, buttons: [] },
  };
}

type ApprovalCallback = Exclude<Callback, FeedbackCallback>;

const STATUS_TEXTS: Record<string, string> = {
  applied: APPROVAL_TEXTS.sent,
  applying: APPROVAL_TEXTS.sending,
  approved: APPROVAL_TEXTS.sending,
  rejected: APPROVAL_TEXTS.rejected,
  expired: APPROVAL_TEXTS.expired,
  failed: APPROVAL_TEXTS.failed,
};

function inTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// D18, D26. The role check comes before any query; the tenant comes from the link. An unknown id and another
// organization's id give the same answer. The log line holds the kind and the id only.
async function handleApprovalCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: ApprovalCallback
): Promise<CallbackResult> {
  if (callback.kind !== "delegation_done" && link.role !== "owner") return { answer: APPROVAL_TEXTS.owner_only };
  const now = deps.now();
  const id = "actionId" in callback ? callback.actionId : "setId" in callback ? callback.setId : callback.delegationId;
  log.info(`tap ${callback.kind} ${id} by user ${link.userId}`);
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) return { answer: NOT_FOUND_TEXT };
  const timeZone = organization.timezone;
  const approvals: ApprovalDeps = { db: deps.db, hooks: deps.hooks, uidplus: deps.uidplus };
  const input = { userId: link.userId, via: "telegram" as const, now };
  // The message that the tap came from, as the user got it. An empty original gives no edit, only the answer.
  const edit = async (
    dedupKey: string,
    outcome: ApprovalEditOutcome,
    extra: {
      heldBy?: "scope" | "paused" | "auth_error";
      actionId?: string;
      counts?: { done: number; skipped: number };
    } = {}
  ): Promise<OutMessage | undefined> => {
    const original = (await findOutboxByDedup(deps.db, ctx, link.userId, dedupKey))?.text ?? "";
    return original === "" ? undefined : approvalEdit({ original, outcome, at: now, timeZone, ...extra });
  };

  switch (callback.kind) {
    case "approve": {
      const result = await approve(approvals, ctx, callback.actionId, input);
      switch (result.kind) {
        case "approved": {
          const heldBy = await heldReason(deps, ctx, callback.actionId);
          return {
            answer: heldBy === undefined ? APPROVAL_TEXTS.approved : HELD_ANSWERS[heldBy],
            edit: await edit(
              `approval:${callback.actionId}`,
              heldBy === undefined ? "approved" : "approved_held",
              heldBy === undefined ? {} : { heldBy, actionId: callback.actionId }
            ),
          };
        }
        case "already_approved":
          return { answer: APPROVAL_TEXTS.already_approved(formatClock(result.at, timeZone, now)) };
        case "expired":
          // Only the tap that expired the row edits the message; a later tap on an expired row only answers.
          return {
            answer: APPROVAL_TEXTS.expired,
            edit: result.byThisTap ? await edit(`approval:${callback.actionId}`, "expired") : undefined,
          };
        case "sending":
          return { answer: APPROVAL_TEXTS.sending };
        case "sent":
          return { answer: APPROVAL_TEXTS.sent };
        case "rejected":
          return { answer: APPROVAL_TEXTS.rejected };
        case "failed":
          return { answer: APPROVAL_TEXTS.failed };
        case "draft_not_ready":
          return { answer: APPROVAL_TEXTS.draft_not_ready };
        case "not_found":
          return { answer: NOT_FOUND_TEXT };
      }
      break;
    }
    case "reject": {
      const result = await reject(approvals, ctx, callback.actionId, input);
      if (result.kind === "rejected") {
        return {
          answer: APPROVAL_TEXTS.rejected_now,
          edit: await edit(`approval:${callback.actionId}`, "rejected"),
        };
      }
      if (result.kind === "already") return { answer: STATUS_TEXTS[result.status] ?? NOT_FOUND_TEXT };
      return { answer: NOT_FOUND_TEXT };
    }
    case "approve_set": {
      const result = await approveSet(approvals, ctx, callback.setId, input);
      if (result.approved === 0) return { answer: APPROVAL_TEXTS.set_nothing };
      const heldBy = await heldReasonOfAny(deps, ctx, result.approvedIds);
      return {
        answer:
          heldBy === undefined
            ? `⏳ ${result.approved} reminders go out within a minute, ${result.skipped} skipped.`
            : `⏳ ${result.approved} reminders approved, ${result.skipped} skipped. ${APPROVAL_TEXTS.held_notes[heldBy]}; /status shows it.`,
        edit: await edit(`approval_set:${callback.setId}`, "approved_set", {
          counts: { done: result.approved, skipped: result.skipped },
        }),
      };
    }
    case "reject_set": {
      const result = await rejectSet(approvals, ctx, callback.setId, input);
      if (result.rejected === 0) return { answer: APPROVAL_TEXTS.set_nothing };
      return {
        answer: `✖️ ${result.rejected} reminders skipped.`,
        edit: await edit(`approval_set:${callback.setId}`, "rejected_set", {
          counts: { done: result.rejected, skipped: result.skipped },
        }),
      };
    }
    case "send_again": {
      const result = await sendAgain(approvals, ctx, callback.actionId, input);
      switch (result.kind) {
        case "created": {
          const heldBy = await heldReason(deps, ctx, result.actionId);
          return {
            answer: heldBy === undefined ? APPROVAL_TEXTS.send_again : APPROVAL_TEXTS.send_again_held[heldBy],
            edit: await edit(`send_result:${callback.actionId}`, "approved"),
          };
        }
        case "already":
          return { answer: APPROVAL_TEXTS.send_again_already };
        case "not_failed":
          return { answer: APPROVAL_TEXTS.send_again_not_failed };
        case "draft_gone":
          return { answer: APPROVAL_TEXTS.send_again_draft_gone };
        case "delegation_closed":
          return { answer: APPROVAL_TEXTS.send_again_delegation_closed };
        case "not_found":
          return { answer: NOT_FOUND_TEXT };
      }
      break;
    }
    case "delegation_done": {
      const result = await inTransaction(deps.db, (trx) =>
        closeDelegation(trx, ctx, callback.delegationId, { actor: link.userId, at: now })
      );
      switch (result.kind) {
        case "done":
          return {
            answer: APPROVAL_TEXTS.done,
            edit: await edit(`delegation_answered:${callback.delegationId}`, "done"),
          };
        case "already":
          return { answer: APPROVAL_TEXTS.done_already };
        case "not_closable":
          return { answer: APPROVAL_TEXTS.done_not_closable };
        case "not_found":
          return { answer: NOT_FOUND_TEXT };
      }
    }
  }
  return { answer: NOT_FOUND_TEXT };
}

const HELD_ANSWERS = {
  scope: APPROVAL_TEXTS.approved_held,
  paused: APPROVAL_TEXTS.approved_paused,
  auth_error: APPROVAL_TEXTS.approved_auth_error,
};

// Why the committer will not claim the send just approved: the scope first, then the state of the mailbox (S3 D10).
// A send or mailbox that cannot be read counts as held by the scope: the toast must not promise a send.
async function heldReason(
  deps: CallbackDeps,
  ctx: TenantContext,
  actionId: string
): Promise<"scope" | "paused" | "auth_error" | undefined> {
  const send = await getSend(deps.db, ctx, actionId);
  const mailbox = send === undefined ? undefined : await getMailbox(deps.db, ctx, send.email.mailbox_id);
  if (send === undefined || mailbox === undefined) return "scope";
  const to = Array.isArray(send.payload.to) ? send.payload.to.filter((item) => typeof item === "string") : [];
  if (!sendScopeAdmits(sendFilterFor(deps.sendScope, mailbox.address), to)) return "scope";
  if (mailbox.status === "paused") return "paused";
  if (mailbox.status === "auth_error") return "auth_error";
  return undefined;
}

// A set holds the first cause found among its approved sends: the mailbox is the same, the recipients can differ.
async function heldReasonOfAny(
  deps: CallbackDeps,
  ctx: TenantContext,
  actionIds: string[]
): Promise<"scope" | "paused" | "auth_error" | undefined> {
  for (const actionId of actionIds) {
    const reason = await heldReason(deps, ctx, actionId);
    if (reason !== undefined) return reason;
  }
  return undefined;
}
