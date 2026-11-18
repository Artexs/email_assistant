import type { SentSyncView } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { isFeatureOn } from "../tenancy";

import { getMailbox, getSentSummary, getSentSyncState } from "./repo";
import { SENT_HEADER_WINDOW_MS } from "./sent-rules";

// The "Track my sent mail" line of one mailbox for the settings view. Reads only.
// Flag off and switch off (or no state row): null, the feature is hidden. Flag off and switch on: `flagOn` is false, so the
// switch can only go off. A mailbox that is not in the organization gives null.
export async function getSentSyncView(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<SentSyncView | null> {
  const mailbox = await getMailbox(db, ctx, mailboxId);
  if (mailbox === undefined) return null;
  const flagOn = await isFeatureOn(db, ctx, "sent_sync");
  const state = await getSentSyncState(db, ctx, mailboxId);
  const enabled = state?.enabled === true;
  if (!flagOn && !enabled) return null;
  const summary = await getSentSummary(db, ctx, mailboxId, { since: new Date(now.getTime() - SENT_HEADER_WINDOW_MS) });
  return {
    flagOn,
    enabled,
    folder: mailbox.folder_map.sent ?? null,
    firstPassDone: state?.firstPassAt != null,
    lastSentAt: summary.newestUserAt?.toISOString() ?? null,
    storedCount: summary.userCount,
    errorCode: state?.lastErrorCode ?? null,
  };
}

// Can the system see the Sent mail of this mailbox? The org flag `sent_sync` is on and the switch of the mailbox is on. A reply
// card says "I cannot see your sent mail" when it is not (F115 D10: then only `\Answered` on the original shows an answer).
export async function isSentVisible(db: Db | Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "sent_sync"))) return false;
  return (await getSentSyncState(db, ctx, mailboxId))?.enabled === true;
}
