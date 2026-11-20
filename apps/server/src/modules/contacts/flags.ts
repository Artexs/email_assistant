import { DAY_MS } from "@ea/core";
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

// How old the last Sent pass may be for the profile to say "the user never wrote to this sender". The Sent pass runs with the
// mail sync (every few minutes), so a pass older than a day means that it fails or the mailbox does not sync.
export const SENT_COVERAGE_FRESH_MS = DAY_MS;

// Sent coverage of one mailbox at `now`: the profile can say "the user never wrote to this sender" only when Sent mail is
// tracked and current. True when the flag `sent_sync` is on, the mailbox switch is on, `first_pass_at` is set, the last Sent
// pass is not older than a day and it ended with no error code. A pass that ends `folder_missing`, `no_folder` or `failed`
// reads no Sent mail, but it still sets `last_pass_at`: the error code is what shows it. The suggestion engine passes the
// result to `suggestionsFor`: without it no blocklist suggestion is made and an open one is withdrawn.
export async function sentCoverage(db: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "sent_sync"))) return false;
  const state = await getSentSyncState(db, ctx, mailboxId);
  if (state === undefined || !state.enabled || state.firstPassAt === null) return false;
  if (state.lastErrorCode !== null || state.lastPassAt === null) return false;
  return now.getTime() - state.lastPassAt.getTime() <= SENT_COVERAGE_FRESH_MS;
}
