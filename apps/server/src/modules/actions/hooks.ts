import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

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
    // `actor` and `via` name the user of a cancel that the user asked for (`user_cancelled`); the system cancels have none.
    input: { delegationId: string; reason: string; at: Date; actor?: string; via?: string }
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

// Open loops (F116): `actions` must not import `loops` (layer rule). A follow-up hangs on a loop; the committer reads the
// loop and writes its counters through these callbacks. `main.ts` and `job:run` wire `loopHooks()` from the `loops` index.
// Lock order (D15): the loop first, then its sends. `isOpen` takes the loop lock, so a caller that must hold it calls it first.
export interface LoopAnchor {
  mailboxId: string;
  // The Message-ID of the own mail that the loop waits on (the last one that restarted the wait): the In-Reply-To.
  messageId: string | null;
  referencesIds: string[];
  subject: string | null;
  to: string[];
  cc: string[];
  language: "pl" | "en";
  // The text of the opening own mail while it is stored; null after retention (the follow-up has no quote then).
  quote: string | null;
  // When the opening own mail was sent.
  sentAt: Date;
}

export interface LoopHooks {
  // undefined: no such loop in this organization.
  anchorOf(db: Db | Transaction<DB>, ctx: TenantContext, loopId: string): Promise<LoopAnchor | undefined>;
  // Locks the loop row (FOR UPDATE) and says whether it is still open. A closed or missing loop: false.
  isOpen(trx: Transaction<DB>, ctx: TenantContext, loopId: string): Promise<boolean>;
  // A follow-up went out. Adds one to `follow_ups_sent`, sets `last_follow_up_at` and restarts the wait (D9). Runs in the
  // transaction of the send, after `isOpen` took the lock.
  onFollowUpSent(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { loopId: string; sendId: string; messageId: string; at: Date }
  ): Promise<void>;
}

// For the callers that never touch a loop (the tests of the older stages). A loop is never open: nothing goes out.
export const noLoopHooks: LoopHooks = {
  anchorOf: async () => undefined,
  isOpen: async () => false,
  onFollowUpSent: async () => undefined,
};
