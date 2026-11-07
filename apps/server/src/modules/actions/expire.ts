import type { ActionType } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { STALE_AFTER_MS } from "./constants";
import { expireReadyOriginals, type ExpireFilter } from "./repo";

// Shared by Undo, the expire-ready CLI and the settings setters (stage 14, as `SettingsDeps.expireReady`).
// A row that a committer run holds now stays. One `action.expired` audit row per expired row, in the caller's transaction.
export async function expireReady(
  trx: Transaction<DB>,
  ctx: TenantContext,
  filter: ExpireFilter,
  opts: { now: Date; reason: "policy_changed" | "undo" | "manual"; actor: string }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
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
  return expired;
}
