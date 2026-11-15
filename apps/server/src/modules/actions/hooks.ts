import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";

// D29: the `actions` module must not import `delegation` (a cycle). The committer, the approvals and the expiry job
// update the delegation through these callbacks; `main.ts` wires them from the `delegation` index.
// Each one runs in the caller's transaction and returns false when the delegation was not in a state that takes the change.
export interface DelegationHooks {
  onSent(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { delegationId: string; sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }
  ): Promise<boolean>;
  onReminderSent(trx: Transaction<DB>, ctx: TenantContext, input: { delegationId: string; at: Date }): Promise<boolean>;
  onCancelled(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { delegationId: string; reason: string; at: Date }
  ): Promise<boolean>;
  // "It went out": the owner says that a send that ended `outcome_unknown` reached the delegate. Locks the delegation row.
  // `changed`: it was `cancelled` with the reason `outcome_unknown` and is `sent` now. `already`: it is past `cancelled` and holds this message id.
  // `not_open`: any other state, or another message id. No SMTP call: the stored message id is the one that the send used.
  onWentOut(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { delegationId: string; sentMessageId: string; at: Date; dueAtWhenNull: Date; actor: string }
  ): Promise<"changed" | "already" | "not_open">;
  // Locks the delegation row (the caller holds the send lock: send, then delegation). A `reminder` send needs the delegation `sent` or `overdue`; a `delegation` send needs it `drafted`,
  // or `cancelled` with the reason `outcome_unknown` or `send_failed` (D6: "Send again" after a failed send).
  isOpen(
    trx: Transaction<DB>,
    ctx: TenantContext,
    delegationId: string,
    kind: "reminder" | "delegation"
  ): Promise<boolean>;
  // A panel edit replaced the waiting send and its draft (F102 ticket). Locks the delegation row (lock order: send, then delegation).
  // true: the delegation was `drafted` and now points at the new draft, the new send and the delegate of the new version.
  // false: any other state or no such delegation; the caller rolls the edit back.
  onSuperseded(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { delegationId: string; draftActionId: string; sendActionId: string; delegateId: string; at: Date }
  ): Promise<boolean>;
  // The reader that lets `actions` resolve the delegate of an edit without importing `delegation` (layer rule).
  // undefined: no such delegate in this organization, or it is not active.
  activeDelegate(
    trx: Transaction<DB>,
    ctx: TenantContext,
    delegateId: string
  ): Promise<{ id: string; name: string; email: string } | undefined>;
}

export const noDelegationHooks: DelegationHooks = {
  onSent: async () => false,
  onReminderSent: async () => false,
  onCancelled: async () => false,
  onWentOut: async () => "not_open",
  isOpen: async () => false,
  onSuperseded: async () => false,
  activeDelegate: async () => undefined,
};

// F102 ticket: what a decision does for the cards of other channels. The real hook is built in `channels` (stage 09);
// `actions` only calls it, in the transaction of the decision. The hook, not the caller, finds out whether an approved
// send is held and by what, so no caller passes `heldBy`.
export interface ApprovalHooks {
  onDecided(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: {
      sendId: string;
      decision: "approved" | "rejected" | "changed" | "expired";
      exceptUserId?: string;
      at: Date;
    }
  ): Promise<void>;
}

export const noApprovalHooks: ApprovalHooks = { onDecided: () => Promise.resolve() };
