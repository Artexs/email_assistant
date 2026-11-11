import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { undo, type ActionsScope, type UndoResult } from "../actions";

import { recordFeedback } from "./feedback";
import { getLabelTarget } from "./repo";

// D10 (a): the Telegram tap and the web button run this one Undo + feedback transaction.
// A mail with no triage result is "not found" before any Undo query, as in the S3 callback.
export async function undoWithFeedback(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: { now: Date; userId: string; scope: ActionsScope }
): Promise<UndoResult> {
  // One transaction: a feedback failure rolls back the reverse rows, so the user can tap again.
  const run = async (trx: Transaction<DB>): Promise<UndoResult> => {
    const target = await getLabelTarget(trx, ctx, emailId);
    if (!target) {
      return { kind: "not_found" };
    }
    const undone = await undo(trx, ctx, emailId, opts);
    // keepLabel: a ✏️ label with a true category stays the latest feedback row. An unsure mail has no wrong category to record.
    if (undone.kind === "started" && target.category !== "unsure") {
      await recordFeedback(trx, ctx, {
        emailId,
        verdict: "wrong",
        source: "undo",
        userId: opts.userId,
        skipIfSame: true,
        keepLabel: true,
      });
    }
    return undone;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
