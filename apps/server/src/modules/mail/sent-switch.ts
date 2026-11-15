import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { isFeatureOn } from "../tenancy";

import { deleteSentEmails, getMailbox, insertSentSyncState, lockSentSyncState, writeSentSwitch } from "./repo";

export type SentSwitchResult = "changed" | "same" | "not_found" | "flag_off";

export interface SentSwitchInput {
  enabled: boolean;
  /** Who asks: the user id for the panel, `cli` for the operator. It goes to the audit row. */
  actor: string;
  at: Date;
}

// A module above `mail` reacts to the switch inside the same transaction (the composition roots fill it in).
export interface SentSwitchHooks {
  /** Runs when the switch goes from on to off, before the stored sent mail is deleted. */
  onDisabled(trx: Transaction<DB>, ctx: TenantContext, input: { mailboxId: string; at: Date }): Promise<unknown>;
}

export const noSentSwitchHooks: SentSwitchHooks = { onDisabled: async () => undefined };

// The consent to read the Sent folder of one mailbox: "Track my sent mail".
// On needs the organization flag and starts a new first pass. Off always works (the user can always withdraw)
// and deletes the stored sent mail of this mailbox: only `sent_emails` rows, never received mail.
// One transaction: the lock on the state row is the lock of the Sent pass, so a pass that runs now writes nothing after it.
export async function setSentSync(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  input: SentSwitchInput,
  hooks: SentSwitchHooks = noSentSwitchHooks
): Promise<{ result: SentSwitchResult; deleted: number }> {
  const run = async (trx: Transaction<DB>) => {
    if (input.enabled && !(await isFeatureOn(trx, ctx, "sent_sync")))
      return { result: "flag_off" as const, deleted: 0 };
    // No lock on the mailbox row: the pass locks the state row first and then writes sent rows, which key-share the mailbox row.
    if ((await getMailbox(trx, ctx, mailboxId)) === undefined) return { result: "not_found" as const, deleted: 0 };

    let state = await lockSentSyncState(trx, ctx, mailboxId);
    if (state === undefined) {
      // A mailbox from before the Sent read has no row: it counts as off.
      await insertSentSyncState(trx, ctx, mailboxId, { enabled: false });
      state = await lockSentSyncState(trx, ctx, mailboxId);
    }
    if (state === undefined || state.enabled === input.enabled) return { result: "same" as const, deleted: 0 };

    await writeSentSwitch(trx, ctx, mailboxId, { enabled: input.enabled, at: input.at });
    if (!input.enabled) await hooks.onDisabled(trx, ctx, { mailboxId, at: input.at });
    const deleted = input.enabled ? 0 : await deleteSentEmails(trx, ctx, mailboxId);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.mailboxSentSyncChanged,
      data: { mailbox_id: mailboxId, enabled: input.enabled, count: deleted },
      at: input.at,
    });
    return { result: "changed" as const, deleted };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
