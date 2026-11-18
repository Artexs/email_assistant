import { draftPayloadSchema, parseToolSwitches, sendPayloadFor, type DraftPayload } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import {
  closeSend,
  createPlanned,
  findSendByKey,
  listOpenReplySendsOfThread,
  replaceApproval,
  type ApprovalHooks,
  type DelegationHooks,
  type PlannedActionInput,
} from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import { isFeatureOn } from "../tenancy";

import { loadReplyFacts } from "./facts";
import { finishReplyRequest, lockReplyRequest, type ReplyRequestRow } from "./repo/requests";

export interface WriteDeps {
  db: Db | Transaction<DB>;
  hooks: DelegationHooks;
  // The cards of a closed or replaced send lose their buttons (the composition root passes the real hook).
  approvalHooks: ApprovalHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  // Test hook: runs inside the write transaction after the rows are written, before the commit. A throw is a crash.
  beforeCommit?: (trx: Transaction<DB>) => void | Promise<void>;
}

export type WriteResult =
  // The pair (or the new version) is stored and the request is `done`.
  | { kind: "written"; sendId: string }
  // The keys of this request were stored before (an earlier run wrote them): no second pair; the request is `done`.
  | { kind: "exists"; sendId: string }
  // The claim is not ours any more (a stale take-back): nothing was written.
  | { kind: "lost" }
  // The request ended `cancelled` with this reason: a gate or a fact changed since the call.
  | { kind: "cancelled"; reason: string }
  // An open reply of the thread answers a newer mail (or this very mail): the request ended `superseded`.
  | { kind: "superseded"; sendId: string };

export function runInTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// One writer at a time for a thread of a mailbox: the decision "is there an open reply for a newer or an older mail" and the insert
// that follows it must not interleave with the same decision of another request. The lock ends with the transaction.
async function lockThread(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, threadKey: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reply_thread:${ctx.orgId}:${mailboxId}:${threadKey}`}, 0))`.execute(
    trx
  );
}

export interface DraftToWrite {
  request: ReplyRequestRow;
  // The `locked_at` of the claim: the token of every conditional write of the request.
  lockedAt: Date;
  body: string;
  language: "pl" | "en";
  // The sender of the mail, from the stored header: the only recipient of the draft.
  fromAddress: string;
  now: Date;
}

// The draft payload of an automatic or a tapped request. The recipient is the stored `From`, the Cc is empty, and no text of the
// model names a recipient, a folder or a command.
export function replyDraftPayload(input: DraftToWrite): DraftPayload | undefined {
  const parsed = draftPayloadSchema.safeParse({
    kind: "reply",
    to: [input.fromAddress],
    cc: [],
    language: input.language,
    body: input.body,
    request_id: input.request.id,
    folder: input.request.folder,
    recipients: "from",
  });
  return parsed.success ? parsed.data : undefined;
}

// The write step of one request: ONE transaction. It takes the settings share lock first (a setter that turns drafts off waits for
// this transaction or this transaction sees its commit), the thread lock, and the row of the request itself under the claim
// token. A changed gate or fact ends the request `cancelled` and writes no draft. The write is idempotent twice over: the
// token compare stops a worker that lost its claim, and the keys `<request id>:create_draft` and `<request id>:send` stop a
// second pair for the same request.
export async function writeReplyDraft(deps: WriteDeps, ctx: TenantContext, input: DraftToWrite): Promise<WriteResult> {
  const { request, lockedAt, now } = input;
  return runInTransaction(deps.db, async (trx) => {
    const hasSettings = (await lockSettingsForShare(trx, ctx, request.mailbox_id)) !== undefined;
    await lockThread(trx, ctx, request.mailbox_id, request.thread_key);
    if (!(await lockReplyRequest(trx, ctx, request.id, lockedAt))) return { kind: "lost" };

    const cancel = async (reason: string): Promise<WriteResult> => {
      await finishReplyRequest(trx, ctx, request.id, lockedAt, { status: "cancelled", reasonCode: reason, now });
      return { kind: "cancelled", reason };
    };

    // The gates, read under the share lock.
    if (!(await isFeatureOn(trx, ctx, "reply_drafts"))) return cancel("feature_off");
    const settings = hasSettings ? await getMailboxSettings(trx, ctx, request.mailbox_id) : undefined;
    if (settings === undefined || settings.mode !== "assist") return cancel("not_assist");
    if (!parseToolSwitches(settings.tool_switches).reply_drafts) return cancel("switch_off");

    // The facts that can change while the model works: an answer in Sent, a suspicious sign.
    const loaded = (await loadReplyFacts(trx, ctx, [request.email_id], { ownerLocale: null })).get(request.email_id);
    if (loaded === undefined) return cancel("mail_gone");
    if (loaded.facts.suspicion.state === "flagged") return cancel("suspicious");
    if (loaded.mail.answered) return cancel("answered");

    if (request.trigger === "redraft") return writeRedraft(deps, trx, ctx, input);

    // The thread rule. An open reply for this mail or for a newer one means that this request has no draft to make; an open reply
    // for an older mail closes (it answers a mail that is not the last one). Mail that came by `received_at`, then by id.
    const open = await listOpenReplySendsOfThread(trx, ctx, request.mailbox_id, request.thread_key);
    const mine = { receivedAt: loaded.mail.receivedAt.getTime(), id: request.email_id };
    const isOlder = (entry: { receivedAt: Date; emailId: string }): boolean =>
      entry.emailId !== mine.id &&
      (entry.receivedAt.getTime() < mine.receivedAt ||
        (entry.receivedAt.getTime() === mine.receivedAt && entry.emailId < mine.id));
    const newer = open.find((entry) => entry.emailId === mine.id || !isOlder(entry));
    if (newer !== undefined) {
      await finishReplyRequest(trx, ctx, request.id, lockedAt, {
        status: "superseded",
        reasonCode: "open_newer",
        sendActionId: newer.sendId,
        now,
      });
      return { kind: "superseded", sendId: newer.sendId };
    }

    const draft = replyDraftPayload(input);
    if (draft === undefined) return cancel("bad_recipient");
    const sendKey = `${request.id}:send`;
    const items: PlannedActionInput[] = [
      { type: "create_draft", payload: draft, status: "ready", idempotencyKey: `${request.id}:create_draft` },
      {
        type: "send",
        payload: sendPayloadFor(draft),
        status: "awaiting_approval",
        idempotencyKey: sendKey,
        dependsOn: "create_draft",
      },
    ];
    const created = await createPlanned(trx, ctx, request.email_id, items);
    if (created.length === 0) {
      // Both keys exist: an earlier write of this request is stored. Nothing is new; the request ends with that send.
      const stored = await findSendByKey(trx, ctx, sendKey);
      if (stored === undefined) throw new Error("the keys of the request exist without a send");
      await finishReplyRequest(trx, ctx, request.id, lockedAt, { status: "done", sendActionId: stored.id, now });
      return { kind: "exists", sendId: stored.id };
    }
    const send = created.find((action) => action.type === "send");
    if (send === undefined || created.length !== 2) throw new Error("a reply pair is half stored");
    for (const action of created) {
      await recordAudit(trx, ctx, {
        emailId: request.email_id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionPlanned,
        data: { action_type: action.type, status: action.status },
        at: now,
      });
    }
    // Close the older open replies of the thread: they answer a mail that is not the last one. The facts above exclude an automatic
    // mail (an out-of-office is no answer and gets no draft), so every mail that reaches this line may close an older reply.
    for (const entry of open) {
      await closeSend(trx, ctx, {
        sendId: entry.sendId,
        reason: "newer_mail",
        notify: false,
        claimed: false,
        now,
        deps: { hooks: deps.hooks, approvalHooks: deps.approvalHooks, uidplus: deps.uidplus },
      });
      // `busy` and `not_open`: leave it. The sweep or the committer ends it.
    }
    if (!(await finishReplyRequest(trx, ctx, request.id, lockedAt, { status: "done", sendActionId: send.id, now }))) {
      // Cannot happen after the lock; the throw rolls the pair back.
      throw new Error("the locked request did not finish");
    }
    await deps.beforeCommit?.(trx);
    return { kind: "written", sendId: send.id };
  });
}

// A redraft makes a new version of the waiting send through the supersede path of the approvals. The old send must still wait.
async function writeRedraft(
  deps: WriteDeps,
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: DraftToWrite
): Promise<WriteResult> {
  const { request, lockedAt, now } = input;
  const end = async (reason: string): Promise<WriteResult> => {
    await finishReplyRequest(trx, ctx, request.id, lockedAt, { status: "cancelled", reasonCode: reason, now });
    return { kind: "cancelled", reason };
  };
  if (request.previous_send_id === null) return end("closed");
  const replaced = await replaceApproval(trx, ctx, {
    sendId: request.previous_send_id,
    // `body_text` (an edit of the user) goes away with the old version: the user asked for a new text.
    payload: { body: input.body, language: input.language, request_id: request.id, body_text: undefined },
    userId: request.requested_by ?? "system",
    via: "web",
    now,
    deps: { hooks: deps.hooks, approvalHooks: deps.approvalHooks, uidplus: deps.uidplus },
  });
  switch (replaced.kind) {
    case "edited":
      await finishReplyRequest(trx, ctx, request.id, lockedAt, { status: "done", sendActionId: replaced.sendId, now });
      await deps.beforeCommit?.(trx);
      return { kind: "written", sendId: replaced.sendId };
    case "changed":
      return end("changed");
    case "drafts_off":
      return end("switch_off");
    case "closed":
    case "not_editable":
    case "not_found":
    case "unchanged":
    case "delegate_inactive":
      return end("closed");
  }
}
