import { sameAddress } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { changeMailboxStatus, getMailbox } from "./repo";

const log = createLog("mail");

export interface RemoveDeps {
  db: Db;
  // Runs inside the delete transaction (fact 6: mail cannot import channels; web.ts wires channels here).
  onRemoved(trx: Transaction<DB>, ctx: TenantContext, input: { mailboxId: string; now: Date }): Promise<void>;
}

export type RemoveResult = { kind: "removed" } | { kind: "not_found" } | { kind: "confirm_mismatch" };

const NOT_FOUND_CODE = "P0002";
const DEADLOCK_CODE = "40P01";

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

// B8: the typed address must match; the pause commits first so that no new claim starts, then one transaction deletes
// the rows, writes the audit row and queues the owners' notice.
export async function removeMailbox(
  deps: RemoveDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { userId: string; confirmAddress: string; now: Date }
): Promise<RemoveResult> {
  const { db } = deps;
  const { now } = input;
  const mailbox = await getMailbox(db, ctx, mailboxId);
  if (!mailbox) return { kind: "not_found" };
  if (!sameAddress(input.confirmAddress, mailbox.address)) return { kind: "confirm_mismatch" };

  const paused = await changeMailboxStatus(db, ctx, mailboxId, { from: "active", to: "paused", at: now });
  const remove = () =>
    db.transaction().execute(async (trx) => {
      await sql`SELECT delete_mailbox(${ctx.orgId}::uuid, ${mailboxId}::uuid)`.execute(trx);
      await recordAudit(trx, ctx, {
        actor: input.userId,
        event: auditEvents.mailboxRemoved,
        data: { mailbox_id: mailboxId },
        at: now,
      });
      await deps.onRemoved(trx, ctx, { mailboxId, now });
    });

  try {
    try {
      await remove();
    } catch (error) {
      if (codeOf(error) !== DEADLOCK_CODE) throw error;
      await remove();
    }
  } catch (error) {
    if (codeOf(error) === NOT_FOUND_CODE) return { kind: "not_found" };
    if (paused) await changeMailboxStatus(db, ctx, mailboxId, { from: "paused", to: "active", at: now });
    throw error;
  }
  log.info(`mailbox ${mailboxId} removed by user ${input.userId}`);
  return { kind: "removed" };
}
