import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getSentSyncState } from "../mail";
import { isFeatureOn } from "../tenancy";

type DbOrTrx = Db | Transaction<DB>;

export interface SenderFlags {
  // The flag `sender_context`: the pass, the sender line and every reader of the profiles.
  context: boolean;
  // The flag `sender_suggestions`; false unless `sender_context` is on too.
  suggestions: boolean;
  // The flag `contact_wait`; false unless `sender_context` is on too.
  contactWait: boolean;
}

// The three flags of the sender context. `sender_suggestions` and `contact_wait` count as off while `sender_context` is off:
// without the profiles they have nothing to read. A stage that reads the profiles asks here, never `isFeatureOn` alone.
export async function senderFlags(db: DbOrTrx, ctx: TenantContext): Promise<SenderFlags> {
  const context = await isFeatureOn(db, ctx, "sender_context");
  if (!context) return { context: false, suggestions: false, contactWait: false };
  const [suggestions, contactWait] = await Promise.all([
    isFeatureOn(db, ctx, "sender_suggestions"),
    isFeatureOn(db, ctx, "contact_wait"),
  ]);
  return { context, suggestions, contactWait };
}

// Sent coverage of one mailbox: the profile can say "the user never wrote to this sender" only when Sent mail is tracked and its
// first pass is done. True when the flag `sent_sync` is on, the mailbox switch is on and `first_pass_at` is set. The
// suggestion engine passes it to `suggestionsFor`: without it no blocklist suggestion is made.
export async function sentCoverage(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "sent_sync"))) return false;
  const state = await getSentSyncState(db, ctx, mailboxId);
  return state !== undefined && state.enabled && state.firstPassAt !== null;
}
