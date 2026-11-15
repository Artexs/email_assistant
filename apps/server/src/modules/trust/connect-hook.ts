import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import type { OnConnected } from "../mail";
import { isFeatureOn, isOrgSuspended } from "../tenancy";

import { queueHistoryCheck } from "./repo";

/**
 * The `onConnected` hook of the mail connect (web, CLI and OAuth Connect): a new mailbox of an organization with `trust_ladder` on and
 * not suspended gets one history check, reason `connect`. A check that is open already stays the only one (the partial unique index of
 * `queueHistoryCheck`). The mail module logs a failure of this hook as one warning and never fails the connect.
 * The composition roots pass the pool; a test that connects inside a transaction passes that transaction.
 */
export function queueHistoryCheckOnConnect(db: Db | Transaction<DB>): OnConnected {
  return async (ctx, mailboxId) => {
    if (await isOrgSuspended(db, ctx)) return;
    if (!(await isFeatureOn(db, ctx, "trust_ladder"))) return;
    await queueHistoryCheck(db, ctx, mailboxId, "connect");
  };
}
