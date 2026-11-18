import { sendRecipients } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { describeError, errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { locateByActionId, type MailProvider } from "../mail";

import { inTransaction, loopHooksOf, type ApplyDeps } from "./apply-shared";
import { DELEGATION_DUE_AFTER_MS } from "./constants";
import { finishAction, insertReverse, updateProviderResult, type ClaimedAction, type DraftRow } from "./repo";
import type { ProviderResult } from "./send-failure";
import type { Prepared } from "./send-prepare";

const log = createLog("actions");

// After the 250 (or the proof in Sent): one transaction. The row is `applied`, the delegation is `sent`, the draft gets a reverse row.
export async function finishApplied(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  prepared: Prepared,
  providerResult: ProviderResult
): Promise<boolean> {
  const { draft, payload, message } = prepared;
  const now = deps.now();
  return inTransaction(deps.db, async (trx) => {
    // A follow-up: the loop lock first, then the send row. The result of `isOpen` does not matter here: the mail
    // went out. The counters of the loop change either way.
    if (payload.kind === "follow_up" && action.loop_id !== null) {
      await loopHooksOf(deps).isOpen(trx, ctx, action.loop_id);
    }
    if (
      !(await finishAction(
        trx,
        ctx,
        action.id,
        action.locked_at,
        { status: "applied", at: now, providerResult },
        { from: ["applying"] }
      ))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: {
        action_type: "send",
        kind: payload.kind,
        recipients: sendRecipients(payload).length,
        delegation_id: payload.delegation_id ?? null,
        reminder: payload.reminder ?? null,
      },
      at: now,
    });
    if (payload.delegation_id !== undefined) {
      if (payload.reminder === undefined) {
        await deps.hooks.onSent(trx, ctx, {
          delegationId: payload.delegation_id,
          sentMessageId: message.messageId,
          sentAt: now,
          dueAtWhenNull: new Date(now.getTime() + DELEGATION_DUE_AFTER_MS),
        });
      } else {
        await deps.hooks.onReminderSent(trx, ctx, { delegationId: payload.delegation_id, at: now });
      }
    }
    if (payload.kind === "follow_up" && action.loop_id !== null) {
      await loopHooksOf(deps).onFollowUpSent(trx, ctx, {
        loopId: action.loop_id,
        sendId: action.id,
        messageId: message.messageId,
        at: now,
      });
    }
    const folder = draft.provider_result?.folder;
    if (deps.mailbox.capabilities.uidplus && typeof folder === "string") {
      const uid = draft.provider_result?.uid;
      await insertReverse(trx, ctx, {
        id: draft.id,
        emailId: draft.email_id,
        loopId: draft.loop_id,
        type: "create_draft",
        payload: { kind: payload.kind, folder, uid: typeof uid === "number" ? uid : null, reason: "sent" },
      });
    }
    return true;
  });
}

// Graph saves the Sent copy itself, maybe some seconds after the 202. The send looks for it at 0, 5 and 15 s and never APPENDs one:
// a copy that arrives late would make two.
export const GRAPH_COPY_WAITS_MS: readonly number[] = [0, 5_000, 10_000];

async function waitForProviderCopy(
  deps: ApplyDeps,
  provider: MailProvider,
  folder: string,
  draft: DraftRow
): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const wait of GRAPH_COPY_WAITS_MS) {
    if (wait > 0) await sleep(wait);
    const found = await locateByActionId(provider, folder, {
      actionId: draft.id,
      hintUid: null,
      since: draft.created_at,
    });
    if (found !== null) return true;
  }
  return false;
}

// Step 5: the Sent copy. Any error leaves the row `applied` with `sent_copy` `failed` (done-when).
// `provider`: a Graph send whose copy is not in Sent yet; the provider owns it (the result notice shows it as found).
export async function saveSentCopy(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider,
  prepared: Prepared,
  raw: Buffer
): Promise<void> {
  const now = deps.now();
  let copy: "found" | "appended" | "provider";
  try {
    const folder = await deps.folders.resolve("sent");
    if (deps.mailbox.sendVia === "graph") {
      copy = (await waitForProviderCopy(deps, provider, folder, prepared.draft)) ? "found" : "provider";
    } else {
      const found = await locateByActionId(provider, folder, {
        actionId: prepared.draft.id,
        hintUid: null,
        since: prepared.draft.created_at,
      });
      if (found === null) await provider.appendMessage(folder, raw, ["\\Seen"], now);
      copy = found === null ? "appended" : "found";
    }
  } catch (error) {
    const label = describeError(error);
    await inTransaction(deps.db, async (trx) => {
      await updateProviderResult(trx, ctx, action.id, { sent_copy: "failed" });
      await recordAudit(trx, ctx, {
        emailId: action.email_id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionSentCopyFailed,
        data: { error: label },
        at: now,
      });
    });
    log.warn("send_copy_failed", { action_id: action.id, ...errorFields(error) });
    return;
  }
  await updateProviderResult(deps.db, ctx, action.id, { sent_copy: copy });
}
