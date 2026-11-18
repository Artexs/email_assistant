import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";

import { closeLockedSend } from "./expiry";
import type { ApprovalHooks, DelegationHooks } from "./hooks";

// Why a waiting or held send of any kind ends without a tap of the user. The reason is the `status_reason` of the
// `expired` send and the `reason_code` of its audit row.
export const closeSendReasons = [
  "answered",
  "newer_mail",
  "original_moved",
  "policy_changed",
  "suspicious",
  "sent_by_user",
  "draft_changed",
  "draft_missing",
] as const;
export type CloseSendReason = (typeof closeSendReasons)[number];

export interface CloseSendDeps {
  hooks: DelegationHooks;
  // The cards of the send lose their buttons through `onDecided` (`expired`).
  approvalHooks: ApprovalHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
}

export type CloseSendResult =
  // `sendId` is the closed send.
  | { kind: "closed"; sendId: string }
  // A run holds the row: `applying`, or `approved` with a fresh lock when the caller does not own the claim.
  | { kind: "busy" }
  // The send is past the states that close (`state` names it): a tap, a send or another close won.
  | { kind: "not_open"; state: string }
  | { kind: "not_found" };

// The shared close of reply drafts (ticket F115, interfaces.md): the send ends `expired` with the reason, its draft closes (`closeDraftOfSend`), the cards
// of every owner are edited (`onDecided`), the delegation hook runs as `expireSend` runs it, and one `action.expired` audit row
// names the reason. It takes any kind, also a follow-up that hangs on a loop (a loop-anchored send has no mail). The caller holds the
// transaction and, for a send of a loop, the lock of the loop first (lock order: the loop, then the send).
// `notify: false` sets `result_notified_at` to `now`: no result notice is due (a close that the sweep or the committer reports in
// its own way). `notify: true` leaves it null: the result detector writes a notice for it (the texts of the new reasons are the
// answered-and-sweep stage of ticket F115; until then the detector skips such a row with a warning).
// `claimed: true` is for the committer that holds the claim of this very row: it also closes its own locked `approved` row.
// `claimed: false` answers `busy` for a locked row. An `applying` send is never closed: the SMTP call may be under way.
// The closing `closeLockedSend` is the same code as `expireSend`, so the delegation and the draft follow one rule.
export async function closeSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    sendId: string;
    reason: CloseSendReason;
    notify: boolean;
    claimed: boolean;
    now: Date;
    deps: CloseSendDeps;
  }
): Promise<CloseSendResult> {
  const result = await closeLockedSend(trx, ctx, input.sendId, {
    reason: input.reason,
    now: input.now,
    actor: "system",
    hooks: input.deps.hooks,
    uidplus: (mailboxId) => input.deps.uidplus(ctx, mailboxId),
    approvedCloses: true,
    claimed: input.claimed,
    ...(input.notify ? {} : { resultNotifiedAt: input.now }),
  });
  switch (result.kind) {
    case "closed":
      await input.deps.approvalHooks.onDecided(trx, ctx, { sendId: input.sendId, decision: "expired", at: input.now });
      return { kind: "closed", sendId: input.sendId };
    case "lost":
      // The row was locked by this transaction and `approved` with a fresh lock that the caller does not own, or it changed
      // under the guard: nothing was written.
      return { kind: "busy" };
    default:
      return result;
  }
}
