import { draftPayloadSchema } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { newerMailInThread, refreshFlagsOfEmail, replyFactsOf, syncSentHeaders, type MailProvider } from "../mail";

import type { ApplyDeps } from "./apply-shared";
import { sentOriginOf, type ClaimedAction, type DraftRow } from "./repo";

const log = createLog("actions");

// What the pass before a reply send decided (F115 stage 09, D7, D10).
// - `continue`: no reason to stop. `answered` tells whether the mail is answered: the copy check then decides the reason.
// - `close`: the send ends `expired` with this reason (the DB facts: a newer mail in the thread, or the mail left its folder).
// - `error`: an IMAP read failed (the flags, or the Sent pass could not finish); nothing is sent. The caller maps the error to a retry.
export type ReplyPass =
  | { kind: "continue"; answered: boolean }
  | { kind: "close"; reason: "newer_mail" | "original_moved" }
  | { kind: "error"; error: unknown };

// The pass runs before the copy check of a reply, before any commit of the send:
// 0. The DB facts: a newer mail in the thread (an automatic mail does not count) → `newer_mail`; the mail is not in the folder that
//    the draft was made for → `original_moved`. No IMAP call.
// 1. The header step of the Sent sync on the committer's own connection (D10). The flag off, the switch off or a mailbox with no Sent
//    folder: go on with the flags only. A pass that ran out of its time budget is an error of the soft kind (the next try goes on
//    from the cursor), because a partial read would let an answer in Sent go unseen. The header step only reads the folder.
// 2. One `fetchFlagsIn` for the original, and the stored flags of that mail are updated (the same writer as the flag refresh).
// 3. Answered = `email_flags.answered` or a user reply in the Sent rows, read after steps 1 and 2.
// One `reply_send_checked` line holds the result codes; no text of a mail goes to the log.
export async function checkReplyBeforeSend(
  deps: Pick<ApplyDeps, "db" | "now" | "mailboxId" | "sentBudgetMs">,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider,
  draft: DraftRow
): Promise<ReplyPass> {
  const emailId = action.email_id;
  if (emailId === null) return { kind: "continue", answered: false };
  const draftPayload = draftPayloadSchema.safeParse(draft.payload);
  const draftFolder = draftPayload.success && draftPayload.data.kind === "reply" ? draftPayload.data.folder : null;

  try {
    const before = (await replyFactsOf(deps.db, ctx, [emailId])).get(emailId);
    if (before === undefined) return { kind: "continue", answered: false };
    if (await newerMailInThread(deps.db, ctx, emailId)) {
      log.info("reply_send_checked", { action_id: action.id, result: "newer_mail" });
      return { kind: "close", reason: "newer_mail" };
    }
    if (draftFolder !== null && before.folder !== draftFolder) {
      log.info("reply_send_checked", { action_id: action.id, result: "original_moved" });
      return { kind: "close", reason: "original_moved" };
    }

    const sent = await syncSentHeaders(
      {
        db: deps.db,
        provider,
        sentOriginOf: (sentCtx, mailboxId, actionId) => sentOriginOf(deps.db, sentCtx, mailboxId, actionId),
        now: deps.now,
        ...(deps.sentBudgetMs === undefined ? {} : { budgetMs: deps.sentBudgetMs }),
      },
      ctx,
      deps.mailboxId
    );
    if (sent.status === "budget") throw new SoftError("the Sent pass ran out of time");

    const flags = await refreshFlagsOfEmail({ db: deps.db, provider, now: deps.now }, ctx, emailId);
    const answered = (await replyFactsOf(deps.db, ctx, [emailId])).get(emailId)?.answered === true;
    log.info("reply_send_checked", {
      action_id: action.id,
      result: answered ? "answered" : "not_answered",
      status: sent.status,
      kind: flags.kind,
    });
    return { kind: "continue", answered };
  } catch (error) {
    return { kind: "error", error };
  }
}
