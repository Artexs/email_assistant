import { randomUUID } from "node:crypto";

import { parseToolSwitches, sendPayloadFor } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createPlanned } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";

import { buildReminderDraft, MAX_REMINDERS } from "./chaser";
import { countPendingReminderSends, getDelegate, getDelegation, lockDelegation, markReminderPlanned } from "./repo";

export interface RemindDeps {
  // A `Transaction` (a test) runs the call inside it.
  db: Db | Transaction<DB>;
}

export type RemindNowResult =
  | { kind: "planned"; sendId: string }
  | {
      kind: "not_open" | "limit_reached" | "reminder_waiting" | "drafts_off" | "delegate_inactive" | "not_found";
    };

// F102 stage 16 (D9, Q4, Q6): the owner asks for a reminder to the delegate now. It plans the same reminder as the chaser: a
// `reminder` draft and its send `awaiting_approval`, with no set (one `approval` card). The mail to the delegate still needs a tap
// (ADR 0003): this function never approves. No due-date gate, no gap, no clock gate: the owner asked now.
// One transaction, the lock order of the chaser: the settings row (share), then the delegation, then its reminder sends. The
// pending-reminder check under the delegation lock is the dedup of a double click, so the idempotency keys carry a fresh id
// (the chaser keys hold the local day: a second reminder on one day would clash with them).
export async function remindNow(
  deps: RemindDeps,
  ctx: TenantContext,
  delegationId: string,
  input: { userId: string; via: "web" | "cli"; now: Date }
): Promise<RemindNowResult> {
  // The mailbox of the delegation, to take its settings lock first (a plain read: the row is locked below).
  const known = await getDelegation(deps.db, ctx, delegationId);
  if (known === undefined) return { kind: "not_found" };
  const run = async (trx: Transaction<DB>): Promise<RemindNowResult> => {
    const version = await lockSettingsForShare(trx, ctx, known.mailbox_id);
    const delegation = await lockDelegation(trx, ctx, delegationId);
    if (delegation === undefined) return { kind: "not_found" };
    if (delegation.status !== "sent" && delegation.status !== "overdue") return { kind: "not_open" };
    if (delegation.reminders_sent >= MAX_REMINDERS) return { kind: "limit_reached" };
    if ((await countPendingReminderSends(trx, ctx, delegationId)) > 0) return { kind: "reminder_waiting" };
    const delegate = await getDelegate(trx, ctx, delegation.delegate_id);
    if (delegate === undefined || !delegate.active) return { kind: "delegate_inactive" };
    const settings = version === undefined ? undefined : await getMailboxSettings(trx, ctx, delegation.mailbox_id);
    const switches = settings === undefined ? undefined : parseToolSwitches(settings.tool_switches);
    if (settings === undefined || settings.mode !== "assist" || switches?.create_draft !== true) {
      return { kind: "drafts_off" };
    }

    const reminder = delegation.reminders_sent + 1;
    const draft = await buildReminderDraft(
      trx,
      ctx,
      { ...delegation, delegate_email: delegate.email, delegate_name: delegate.name },
      reminder
    );
    const token = randomUUID();
    const created = await createPlanned(trx, ctx, delegation.email_id, [
      {
        type: "create_draft",
        payload: draft,
        status: "ready",
        idempotencyKey: `${delegation.email_id}:create_draft:reminder:manual:${token}`,
      },
      {
        type: "send",
        payload: sendPayloadFor(draft),
        status: "awaiting_approval",
        idempotencyKey: `${delegation.email_id}:send:reminder:manual:${token}`,
        dependsOn: "create_draft",
      },
    ]);
    const send = created.find((action) => action.type === "send");
    // The keys hold a fresh id: a missing row is a bug, not a repeat.
    if (send === undefined) throw new Error("remind now planned no send");
    await markReminderPlanned(trx, ctx, delegationId, input.now);
    await recordAudit(trx, ctx, {
      emailId: delegation.email_id,
      actionId: send.id,
      actor: input.userId,
      event: auditEvents.delegationRemindRequested,
      data: { delegation_id: delegationId, reminder, via: input.via },
      at: input.now,
    });
    return { kind: "planned", sendId: send.id };
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}
