import type { ActionType } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";

import { STALE_AFTER_MS } from "./constants";
import { expireSend } from "./expiry";
import type { DelegationHooks } from "./hooks";
import { expireReadyOriginals, listAwaitingSendIds, type ExpireFilter } from "./repo";

// Shared by Undo, the expire-ready CLI and the settings setters (stage 14, as `SettingsDeps.expireReady`).
// A row that a committer run holds now stays. One `action.expired` audit row per expired row, in the caller's transaction.
// `filter.sends`: the `awaiting_approval` sends of the mailbox close too, each with its draft and delegation (D13, D33). It needs `opts.sendClose`.
export async function expireReady(
  trx: Transaction<DB>,
  ctx: TenantContext,
  filter: ExpireFilter,
  opts: {
    now: Date;
    reason: "policy_changed" | "undo" | "manual";
    actor: string;
    sendClose?: { hooks: DelegationHooks; uidplus: boolean };
  }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
  if (filter.sends && opts.sendClose === undefined) {
    throw new HardError("expireReady: filter.sends needs opts.sendClose");
  }
  const expired = await expireReadyOriginals(trx, ctx, filter, {
    now: opts.now,
    staleBefore: new Date(opts.now.getTime() - STALE_AFTER_MS),
    reason: opts.reason,
  });
  for (const row of expired) {
    await recordAudit(trx, ctx, {
      emailId: row.emailId,
      actionId: row.id,
      actor: opts.actor,
      event: auditEvents.actionExpired,
      reasonCode: opts.reason,
      data: { action_type: row.type },
    });
  }
  if (filter.sends && opts.sendClose) {
    const sends = await listAwaitingSendIds(trx, ctx, filter.mailboxId, { emailId: filter.emailId });
    for (const send of sends) {
      const closed = await expireSend(trx, ctx, send.id, {
        reason: "policy_changed",
        now: opts.now,
        actor: opts.actor,
        hooks: opts.sendClose.hooks,
        uidplus: opts.sendClose.uidplus,
      });
      if (closed) expired.push({ id: send.id, emailId: send.emailId, type: "send" });
    }
  }
  return expired;
}
