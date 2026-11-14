import { MAILBOX_ACTION_TYPES, UNDO_WINDOW_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { getEmailMailbox, setUndoPending } from "../mail";

import { expireReady } from "./expire";
import { insertReverse, lockActionsForUndo } from "./repo";
import { claimFilterFor, scopeAdmits, type ActionsScope } from "./scope";

export type UndoResult =
  | { kind: "started"; created: number }
  | { kind: "already" } // a reverse row exists (any status) or the originals are undone
  | { kind: "nothing" } // no applied mailbox action
  | { kind: "too_old" } // applied, but applied_at older than UNDO_WINDOW_MS
  | { kind: "held" } // undoable, but ACTIONS_SCOPE or the mailbox status would hold the reverse back (M9)
  | { kind: "not_found" }; // no such mail in this organization

// D10: every undoable action of the mail gets a reverse row; the committer applies it. The caller writes the feedback.
export async function undo(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: { now: Date; userId: string; scope: ActionsScope }
): Promise<UndoResult> {
  const run = async (trx: Transaction<DB>): Promise<UndoResult> => {
    const mail = await getEmailMailbox(trx, ctx, emailId);
    if (mail === undefined) return { kind: "not_found" };

    const candidates = await lockActionsForUndo(trx, ctx, emailId);
    const windowStart = opts.now.getTime() - UNDO_WINDOW_MS;
    const undoable = candidates.filter(
      (row) =>
        row.status === "applied" &&
        row.reverse === null &&
        row.appliedAt !== null &&
        row.appliedAt.getTime() >= windowStart
    );

    if (undoable.length > 0) {
      // M9: the committer would never claim the reverse, so the toast "within a minute" would be false.
      const applies = mail.mailboxStatus === "active" && scopeAdmits(claimFilterFor(opts.scope), mail);
      if (!applies) return { kind: "held" };

      let created = 0;
      let reverseMove = false;
      for (const original of undoable) {
        const reverseId = await insertReverse(trx, ctx, {
          id: original.id,
          emailId,
          type: original.type,
          payload: original.payload,
        });
        // null = a race lost: the reverse exists.
        if (reverseId === null) continue;
        created += 1;
        if (original.type === "move") reverseMove = true;
        await recordAudit(trx, ctx, {
          emailId,
          actionId: original.id,
          actor: opts.userId,
          event: auditEvents.actionUndoRequested,
          data: { original_action_id: original.id, reverse_action_id: reverseId, action_type: original.type },
        });
      }
      if (created > 0) {
        // D22: the sync stores no INBOX copy of this mail while the reverse move runs.
        if (reverseMove) await setUndoPending(trx, ctx, emailId, opts.now);
        // m13: a `ready` original in a retry wait would move the mail again after the Undo.
        await expireReady(
          trx,
          ctx,
          { mailboxId: mail.mailboxId, emailId, types: MAILBOX_ACTION_TYPES },
          { now: opts.now, reason: "undo", actor: opts.userId }
        );
        return { kind: "started", created };
      }
      return { kind: "already" };
    }

    if (candidates.some((row) => row.reverse !== null || row.status === "undone")) return { kind: "already" };
    if (candidates.some((row) => row.status === "applied")) return { kind: "too_old" };
    return { kind: "nothing" };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
