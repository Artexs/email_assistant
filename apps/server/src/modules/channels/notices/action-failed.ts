import { MAILBOX_ACTION_TYPES, MOVE_TARGET_NAMES, type NoticeView } from "@ea/core";

import { type Db, type TenantContext } from "../../../platform/db";
import { listFailedUnnotified, markNotified } from "../../actions";
import { isSyntheticMessageId } from "../../mail";
import { type LinkedChat } from "../port";

import { DbOrTrx, queue, warnSkipped, type Detector } from "./run";

export const ACTION_FAILED_LOOKBACK_MS = 24 * 3_600_000;
export const ACTION_FAILED_LIMIT = 50;

function isMailboxActionType(type: string): type is (typeof MAILBOX_ACTION_TYPES)[number] {
  return (MAILBOX_ACTION_TYPES as readonly string[]).includes(type);
}

// D11: owners get one notice per failed action; the dedup key and `notified_at` keep it single.
async function detectActionFailed(db: DbOrTrx, ctx: TenantContext, owners: LinkedChat[], now: Date): Promise<void> {
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

export const actionFailedDetector: Detector = {
  name: "action-failed",
  kinds: ["action_failed"],
  detect: (run) => detectActionFailed(run.db, run.ctx, run.owners, run.now),
};
