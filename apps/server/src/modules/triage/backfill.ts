import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { requeueTooOld } from "../mail";

// One-off backfill step: real INBOX mail of the window that the worker skipped as `too_old` gets a new triage run.
// The status change and its audit rows go in one transaction.
export async function requeueBackfillWindow(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; now: Date }
): Promise<number> {
  const run = async (trx: Transaction<DB>): Promise<number> => {
    const ids = await requeueTooOld(trx, ctx, mailboxId, opts);
    for (const id of ids) {
      await recordAudit(trx, ctx, {
        emailId: id,
        actor: "system",
        event: auditEvents.emailRequeued,
        reasonCode: "backfill",
        data: { mailbox_id: mailboxId },
        at: opts.now,
      });
    }
    return ids.length;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
