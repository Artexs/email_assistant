import {
  cleanUserText,
  draftPayloadSchema,
  MAX_REDRAFTS,
  parseToolSwitches,
  replyEligibility,
  replyRecipients,
  replyRecipientsProblem,
  sameRecipients,
  sendPayloadSchema,
  type ReplyBlockReason,
  type ReplyRecipientMode,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import {
  getSend,
  listOpenReplySendsOfThread,
  newestVersionOf,
  replaceApproval,
  type ApprovalDeps,
  type ApprovalInput,
} from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings } from "../config";
import { getMailbox, replyFactsOf } from "../mail";
import { getMembership, isFeatureOn } from "../tenancy";

import { loadReplyFacts } from "./facts";
import { countRedrafts, createReplyRequest, findOpenRequest, type ReplyTrigger } from "./repo/requests";
import { lockThread, runInTransaction } from "./write";

// The services behind the Telegram buttons and the reply routes: a request for a draft, a new version from one line of
// instruction, and a new version with other recipients. The caller checks nothing: the owner check, the gates and the limits are here.

// The instruction of a user is one line of 1 to 300 characters (the column holds 300).
export const INSTRUCTION_MAX = 300;
// At most this many redraft requests for one mail.
export const REDRAFT_LIMIT = MAX_REDRAFTS;

// The text of a user, cleaned: control and direction characters gone, one line. null: empty or too long. It is data for the model and is
// never a recipient, a folder or a command.
export function cleanInstruction(text: string): string | null {
  const clean = cleanUserText(text, { oneLine: true });
  const length = Array.from(clean).length;
  return length < 1 || length > INSTRUCTION_MAX ? null : clean;
}

export type ReplyBlock = ReplyBlockReason | "policy_changed";

interface ReplyServiceDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

interface Actor {
  userId: string;
  via: ApprovalInput["via"];
}

export type RequestReplyResult =
  | { kind: "queued"; requestId: string }
  // A reply for this mail waits or is on its way out: the caller shows it.
  | { kind: "open"; sendId: string; status: string }
  | { kind: "blocked"; reason: ReplyBlock }
  | { kind: "feature_off" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_instruction" };

export type RedraftReplyResult =
  | { kind: "queued"; requestId: string }
  | { kind: "blocked"; reason: ReplyBlock }
  | { kind: "feature_off" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_instruction" }
  | { kind: "redraft_limit" }
  // The send was replaced by a newer version: `currentId` is the newest.
  | { kind: "changed"; currentId: string }
  // The send does not wait for a tap any more; `state` is its status.
  | { kind: "closed"; state: string };

async function isOwner(db: Db | Transaction<DB>, ctx: TenantContext, userId: string): Promise<boolean> {
  return (await getMembership(db, ctx, userId))?.role === "owner";
}

// The gates of the mailbox for a draft that goes to Drafts: a password mailbox (an OAuth mailbox has no reply drafts yet), the mode
// `assist` and the switch. The drafter job and the write step check them again.
async function mailboxBlock(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<ReplyBlock | undefined> {
  const mailbox = await getMailbox(trx, ctx, mailboxId);
  if (mailbox === undefined) return "not_checked";
  if (mailbox.oauth_provider !== null) return "oauth_mailbox";
  const settings = await getMailboxSettings(trx, ctx, mailboxId);
  if (settings === undefined || settings.mode !== "assist" || !parseToolSwitches(settings.tool_switches).reply_drafts) {
    return "policy_changed";
  }
  return undefined;
}

async function recordRequested(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { emailId: string; requestId: string; actor: Actor; trigger: ReplyTrigger; now: Date }
): Promise<void> {
  // One flat row, ids and codes only: never the instruction. The Telegram result detector reads `via` to answer in the same channel.
  await recordAudit(trx, ctx, {
    emailId: input.emailId,
    actor: input.actor.userId,
    event: auditEvents.replyRequested,
    data: { via: input.actor.via, trigger: input.trigger, reply_request_id: input.requestId },
    at: input.now,
  });
}

// A user asks for a draft of one mail ("Draft reply"). The rules of `replyEligibility` for the trigger `tap` run first: a block answers
// at once and nothing is queued. A reply that waits for this mail is answered with `open`; a request of this mail that is still
// waiting is answered with its id (a second tap makes no second call).
export async function requestReply(
  deps: ReplyServiceDeps,
  ctx: TenantContext,
  input: Actor & { emailId: string; instruction?: string }
): Promise<RequestReplyResult> {
  if (!(await isOwner(deps.db, ctx, input.userId))) return { kind: "forbidden" };
  if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return { kind: "feature_off" };
  let instruction: string | null = null;
  if (input.instruction !== undefined) {
    instruction = cleanInstruction(input.instruction);
    if (instruction === null) return { kind: "invalid_instruction" };
  }
  const now = deps.now();
  return runInTransaction(deps.db, async (trx): Promise<RequestReplyResult> => {
    const loaded = (await loadReplyFacts(trx, ctx, [input.emailId], { ownerLocale: null })).get(input.emailId);
    if (loaded === undefined) return { kind: "not_found" };
    const { mail } = loaded;
    await lockThread(trx, ctx, mail.mailboxId, mail.threadKey);
    const gate = await mailboxBlock(trx, ctx, mail.mailboxId);
    if (gate !== undefined) return { kind: "blocked", reason: gate };
    const verdict = replyEligibility(loaded.facts, { trigger: "tap", now });
    if (!verdict.ok) return { kind: "blocked", reason: verdict.reason };

    const open = (await listOpenReplySendsOfThread(trx, ctx, mail.mailboxId, mail.threadKey)).find(
      (entry) => entry.emailId === input.emailId
    );
    if (open !== undefined) return { kind: "open", sendId: open.sendId, status: open.status };
    const waiting = await findOpenRequest(trx, ctx, { emailId: input.emailId, trigger: "tap" });
    if (waiting !== undefined) return { kind: "queued", requestId: waiting };

    const requestId = await createReplyRequest(trx, ctx, {
      mailboxId: mail.mailboxId,
      emailId: input.emailId,
      threadKey: mail.threadKey,
      folder: mail.folder,
      trigger: "tap",
      instruction,
      requestedBy: input.userId,
      nextAttemptAt: now,
      createdAt: now,
    });
    if (requestId === null) throw new Error("a tap request must insert");
    await recordRequested(trx, ctx, { emailId: input.emailId, requestId, actor: input, trigger: "tap", now });
    return { kind: "queued", requestId };
  });
}

// A user asks for a new version of a waiting reply from one line of instruction. The old send stays open until the new version
// exists (the drafter job replaces it). At most 5 redraft requests for one mail. The line is data for the model, nothing else.
export async function redraftReply(
  deps: ReplyServiceDeps,
  ctx: TenantContext,
  input: Actor & { sendId: string; instruction: string }
): Promise<RedraftReplyResult> {
  if (!(await isOwner(deps.db, ctx, input.userId))) return { kind: "forbidden" };
  if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return { kind: "feature_off" };
  const instruction = cleanInstruction(input.instruction);
  if (instruction === null) return { kind: "invalid_instruction" };
  const now = deps.now();
  return runInTransaction(deps.db, async (trx): Promise<RedraftReplyResult> => {
    const send = await getSend(trx, ctx, input.sendId);
    if (send === undefined || send.email_id === null) return { kind: "not_found" };
    const payload = sendPayloadSchema.safeParse(send.payload);
    if (!payload.success || payload.data.kind !== "reply") return { kind: "not_found" };
    if (send.status === "expired" && send.status_reason === "superseded") {
      return { kind: "changed", currentId: await newestVersionOf(trx, ctx, send.id) };
    }
    if (send.status !== "awaiting_approval") return { kind: "closed", state: send.status };

    const loaded = (await loadReplyFacts(trx, ctx, [send.email_id], { ownerLocale: null })).get(send.email_id);
    if (loaded === undefined) return { kind: "not_found" };
    const { mail } = loaded;
    await lockThread(trx, ctx, mail.mailboxId, mail.threadKey);
    const gate = await mailboxBlock(trx, ctx, mail.mailboxId);
    if (gate !== undefined) return { kind: "blocked", reason: gate };
    const verdict = replyEligibility(loaded.facts, { trigger: "redraft", now });
    if (!verdict.ok) return { kind: "blocked", reason: verdict.reason };

    const waiting = await findOpenRequest(trx, ctx, {
      emailId: send.email_id,
      trigger: "redraft",
      previousSendId: send.id,
    });
    if (waiting !== undefined) return { kind: "queued", requestId: waiting };
    if ((await countRedrafts(trx, ctx, send.email_id)) >= REDRAFT_LIMIT) return { kind: "redraft_limit" };

    const requestId = await createReplyRequest(trx, ctx, {
      mailboxId: mail.mailboxId,
      emailId: send.email_id,
      threadKey: mail.threadKey,
      folder: mail.folder,
      trigger: "redraft",
      instruction,
      requestedBy: input.userId,
      previousSendId: send.id,
      nextAttemptAt: now,
      createdAt: now,
    });
    if (requestId === null) throw new Error("a redraft request must insert");
    await recordRequested(trx, ctx, { emailId: send.email_id, requestId, actor: input, trigger: "redraft", now });
    return { kind: "queued", requestId };
  });
}

export type SetRecipientsResult =
  | { kind: "edited"; sendId: string; version: number }
  | { kind: "changed"; currentId: string }
  | { kind: "closed"; state: string }
  | { kind: "not_editable" | "unchanged" | "drafts_off" | "not_found" | "forbidden" | "feature_off" }
  | { kind: "too_many_recipients" | "no_reply_to" | "no_others" | "bad_recipient" };

// A new version of a waiting reply with other recipients. No model call. `all`: To is the sender, Cc is every other address of To and
// Cc of the mail (not an own mailbox), at most 10. `reply_to`: the Reply-To of the mail. `from`: back to the sender only. The addresses
// come from the stored headers of the mail, never from text.
export async function setReplyRecipients(
  deps: ApprovalDeps,
  ctx: TenantContext,
  input: Actor & { sendId: string; mode: ReplyRecipientMode; now: Date }
): Promise<SetRecipientsResult> {
  if (!(await isOwner(deps.db, ctx, input.userId))) return { kind: "forbidden" };
  if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return { kind: "feature_off" };
  return runInTransaction(deps.db, async (trx): Promise<SetRecipientsResult> => {
    // What the patch builder found when it refused; the replace answers `closed` for it and this maps it back.
    let refusal:
      | Extract<SetRecipientsResult, { kind: "too_many_recipients" | "no_reply_to" | "no_others" | "bad_recipient" }>
      | undefined;
    const replaced = await replaceApproval(trx, ctx, {
      sendId: input.sendId,
      userId: input.userId,
      via: input.via,
      now: input.now,
      deps,
      payload: async ({ send, kind, draftPayload }) => {
        const refuse = (found: NonNullable<typeof refusal>) => {
          refusal = found;
          return { refuse: { kind: "closed" as const, state: found.kind } };
        };
        if (kind !== "reply" || draftPayload.kind !== "reply" || send.email_id === null) {
          return { refuse: { kind: "closed" as const, state: "not_reply" } };
        }
        const mail = (await replyFactsOf(trx, ctx, [send.email_id])).get(send.email_id);
        if (mail === undefined || mail.fromAddress === null) return refuse({ kind: "bad_recipient" });
        const chosen = replyRecipients(input.mode, {
          from: mail.fromAddress,
          toAddresses: mail.toAddresses,
          ccAddresses: mail.ccAddresses,
          replyTo: mail.replyTo,
          own: mail.ownAddresses,
        });
        if (chosen.kind !== "ok") return refuse({ kind: chosen.kind });
        const { value } = chosen;
        if (draftPayload.recipients === value.recipients && sameRecipients(draftPayload, value)) {
          return { refuse: { kind: "unchanged" as const } };
        }
        // The draft and the send must pass their schemas and the recipient rules; a stored address that does not is refused here.
        const patch = { to: value.to, cc: value.cc, recipients: value.recipients };
        if (
          replyRecipientsProblem(value, mail.ownAddresses) !== null ||
          !draftPayloadSchema.safeParse({ ...draftPayload, ...patch }).success
        ) {
          return refuse({ kind: "bad_recipient" });
        }
        return { patch };
      },
    });
    if (refusal !== undefined && replaced.kind === "closed") return refusal;
    switch (replaced.kind) {
      case "edited":
        return { kind: "edited", sendId: replaced.sendId, version: replaced.version };
      // Only a delegation has a delegate: a reply never gets here, and a closed state answers the same.
      case "delegate_inactive":
        return { kind: "closed", state: replaced.kind };
      case "unchanged":
      case "not_editable":
      case "drafts_off":
      case "not_found":
        return { kind: replaced.kind };
      case "changed":
        return replaced;
      case "closed":
        return replaced;
    }
  });
}
