import type { SyncFolderDefault, SyncFolderKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";

import { INBOX } from "./port";
import { getMailbox, insertSyncFolders, lockSyncFolderByKey, updateSyncFolderEnabled } from "./repo";

type DbOrTrx = Db | Transaction<DB>;

// Inserts the missing INBOX row and picks. Existing rows stay as they are.
// An INBOX row added here is a repair: it gets no audit row.
export async function ensureSyncFolders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  picks: readonly SyncFolderDefault[],
  at: Date
): Promise<SyncFolderKey[]> {
  const run = async (trx: DbOrTrx): Promise<SyncFolderKey[]> => {
    if (!(await getMailbox(trx, ctx, mailboxId))) throw new HardError("mailbox not found");
    const inserted = await insertSyncFolders(
      trx,
      ctx,
      mailboxId,
      [{ key: "inbox", path: INBOX, role: "inbox" }, ...picks],
      at
    );
    const added = inserted.filter((row) => row.key !== "inbox");
    for (const row of added) {
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.mailboxSyncFolderAdded,
        data: { mailbox_id: mailboxId, folder_key: row.key, role: row.role },
        at,
      });
    }
    return added.map((row) => row.key);
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

export type SyncFolderSwitchResult = "changed" | "same" | "not_found";

// Off to on clears the cursor: the folder starts with a new first sync.
export async function setSyncFolderEnabled(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: Exclude<SyncFolderKey, "inbox">,
  enabled: boolean,
  actor: "cli" | "system",
  at: Date
): Promise<SyncFolderSwitchResult> {
  const run = async (trx: Transaction<DB>): Promise<SyncFolderSwitchResult> => {
    const folder = await lockSyncFolderByKey(trx, ctx, mailboxId, key);
    if (!folder) return "not_found";
    if (folder.enabled === enabled) return "same";
    const updated = await updateSyncFolderEnabled(trx, ctx, folder.id, {
      enabled,
      clearCursor: enabled,
      at,
    });
    if (!updated) return "not_found";
    await recordAudit(trx, ctx, {
      actor,
      event: auditEvents.mailboxSyncFolderChanged,
      data: { mailbox_id: mailboxId, folder_key: key, enabled },
      at,
    });
    return "changed";
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
