import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { lockLatestOriginalMove, markUndone } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { clearReturned, getEmailMailbox, listReturned, listSyncTargets } from "../mail";

import { recordFeedback } from "./feedback";
import { latestTriageResult } from "./repo";

const log = createLog("triage");

const BATCH_SIZE = 50;

export interface ReturnedJobDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  batchSize?: number;
}

// D12: one transaction per mail. The row lock on the original move keeps Undo and this job in turn (M8).
export async function processReturned(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  now: Date
): Promise<{ feedback: boolean; undone: boolean }> {
  const run = async (trx: Transaction<DB>): Promise<{ feedback: boolean; undone: boolean }> => {
    // No such mail in this organization: nothing to write.
    const mail = await getEmailMailbox(trx, ctx, emailId);
    if (mail === undefined) return { feedback: false, undone: false };

    const move = await lockLatestOriginalMove(trx, ctx, emailId);
    const category = (await latestTriageResult(trx, ctx, emailId))?.category;
    const undoneNow = move?.status === "applied" && (move.reverseStatus === null || move.reverseStatus === "failed");

    let undone = false;
    if (move !== undefined && undoneNow) {
      undone = await markUndone(trx, ctx, move.id, { at: now, reason: "user_moved_back" });
      if (undone) {
        await recordAudit(trx, ctx, {
          emailId,
          actionId: move.id,
          actor: "system",
          event: auditEvents.actionUndone,
          data: { reason: "user_moved_back" },
        });
      }
    }

    // A reverse row of any status means an Undo tap: its `undo` feedback row exists already.
    let feedback = false;
    if (undone && move?.reverseStatus === null && category !== undefined && category !== "unsure") {
      const saved = await recordFeedback(trx, ctx, {
        emailId,
        verdict: "wrong",
        source: "imap_move",
        keepLabel: true,
      });
      feedback = saved.saved;
    }

    await recordAudit(trx, ctx, {
      emailId,
      actor: "system",
      event: auditEvents.emailReturned,
      data: { mailbox_id: mail.mailboxId, feedback, move_action_id: move?.id ?? null },
    });
    await clearReturned(trx, ctx, emailId);
    log.debug(`returned ${emailId}: feedback ${feedback}`);
    return { feedback, undone };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export function createReturnedJob(deps: ReturnedJobDeps): { run(): Promise<void> } {
  const limit = deps.batchSize ?? BATCH_SIZE;
  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        let processed = 0;
        try {
          const rows = await listReturned(deps.db, ctx, mailboxId, { limit });
          for (const row of rows) {
            await processReturned(deps.db, ctx, row.id, deps.now());
            processed += 1;
          }
        } catch (error) {
          log.error(`returned ${mailboxId}: ${describeError(error)}`);
        }
        if (processed > 0) log.info(`returned ${mailboxId}: processed ${processed}`);
      }
    },
  };
}
