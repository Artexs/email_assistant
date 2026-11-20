import { MAILBOX_ACTION_TYPES, MOVE_TARGET_NAMES, type NoticeView, DAY_MS } from "@ea/core";

import { type Db, type TenantContext } from "../../../platform/db";
import { listFailedFollowUps, listFailedUnnotified, markNotified, markResultNotified } from "../../actions";
import { isSyntheticMessageId } from "../../mail";
import { isFeatureOn } from "../../tenancy";
import { type NoticeRecipient } from "../notice-fan-out";

import { panelListUrlOf } from "./approval";
import { DbOrTrx, queue, warnSkipped, type Detector } from "./run";

export const ACTION_FAILED_LOOKBACK_MS = DAY_MS;
export const ACTION_FAILED_LIMIT = 50;

function isMailboxActionType(type: string): type is (typeof MAILBOX_ACTION_TYPES)[number] {
  return (MAILBOX_ACTION_TYPES as readonly string[]).includes(type);
}

// Owners get one notice per failed action; the dedup key and `notified_at` keep it single.
async function detectActionFailed(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: NoticeRecipient[],
  now: Date
): Promise<void> {
  const failed = await listFailedUnnotified(db, ctx, { limit: ACTION_FAILED_LIMIT });
  for (const action of failed) {
    const run = async (trx: DbOrTrx) => {
      if (
        (isMailboxActionType(action.type) || (action.type === "create_draft" && action.reverse)) &&
        action.updated_at.getTime() >= now.getTime() - ACTION_FAILED_LOOKBACK_MS
      ) {
        const key = typeof action.payload.folder === "string" ? action.payload.folder : undefined;
        const folderName =
          action.type === "move" && key !== undefined && Object.hasOwn(MOVE_TARGET_NAMES, key)
            ? MOVE_TARGET_NAMES[key as keyof typeof MOVE_TARGET_NAMES]
            : null;
        const reason =
          action.type !== "create_draft" &&
          (action.status_reason === "mail_not_found" || action.status_reason === "bad_payload")
            ? action.status_reason
            : "other";
        const view: NoticeView<"action_failed"> = {
          actionType: action.type,
          reverse: action.reverse,
          reason,
          folderName,
          sourceFolder: action.source_folder,
          currentFolder: action.folder,
          from: action.from_address,
          subject: action.subject,
          synthetic: isSyntheticMessageId(action.message_id_header),
          attempts: action.attempts,
        };
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "action_failed",
              dedupKey: `action_failed:${action.id}`,
              emailId: action.email_id,
              eventAt: action.updated_at,
              view,
            },
            now
          );
        }
      }
      await markNotified(trx, ctx, action.id, now);
    };
    try {
      await (db.isTransaction ? run(db) : (db as Db).transaction().execute(run));
    } catch (error) {
      warnSkipped("action_failed", action.id, error);
    }
  }
}

// A follow-up that failed: one fixed `action_failed` notice per owner, no recipient, no text,
// so the consent gate has nothing to withhold. A send that may have gone out (`outcome_unknown`) says so. The mark is
// `result_notified_at` (the send's own `notified_at` marks its approval card). There is no "Send again": a new follow-up is drafted
// from its loop.
async function detectFailedFollowUps(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: NoticeRecipient[],
  now: Date,
  webBaseUrl: string | undefined
): Promise<void> {
  if (owners.length === 0) return;
  const failed = await listFailedFollowUps(db, ctx, { limit: ACTION_FAILED_LIMIT });
  if (failed.length === 0) return;
  const panelBase = webBaseUrl !== undefined && (await isFeatureOn(db, ctx, "approvals_page")) ? webBaseUrl : undefined;
  const panelUrl = panelBase === undefined ? undefined : panelListUrlOf(panelBase);
  for (const send of failed) {
    const run = async (trx: DbOrTrx) => {
      for (const owner of owners) {
        await queue(
          trx,
          ctx,
          {
            userId: owner.userId,
            locale: owner.locale,
            kind: "action_failed",
            dedupKey: `action_failed:${send.id}`,
            loopId: send.loopId,
            eventAt: send.updatedAt,
            view: {
              followUp: { cause: send.unknown ? "unknown" : "failed", ...(panelUrl === undefined ? {} : { panelUrl }) },
            },
          },
          now
        );
      }
      await markResultNotified(trx, ctx, send.id, now);
    };
    try {
      await (db.isTransaction ? run(db) : (db as Db).transaction().execute(run));
    } catch (error) {
      warnSkipped("action_failed", send.id, error);
    }
  }
}

export const actionFailedDetector: Detector = {
  name: "action-failed",
  kinds: ["action_failed"],
  async detect(run) {
    await detectActionFailed(run.db, run.ctx, run.owners, run.now);
    await detectFailedFollowUps(run.db, run.ctx, run.owners, run.now, run.deps.webBaseUrl);
  },
};
