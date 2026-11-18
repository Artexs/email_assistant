import { contactWaitDays, normalizeSenderAddress, usualReplyDays } from "@ea/core";
import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";

import { senderFlags } from "./flags";

type DbOrTrx = Db | Transaction<DB>;

export interface ContactWait {
  // Working days to wait before the loop is due.
  waitDays: number;
  // The usual reply time of the contact in whole days, for the loop line.
  usualReplyDays: number;
}

interface WaitRow {
  median_their_reply_hours: number | null;
  reply_samples_theirs: number;
}

// How long one contact usually takes to reply, as the wait of a new open loop. Null with `contact_wait` or `sender_context`
// off, with no stored profile, or with fewer than 5 reply samples (`contactWaitDays`). The address is normalised and hashed
// here; the hash stays in this function.
export async function contactWaitFor(
  deps: { db: DbOrTrx; credentialsKey: string },
  ctx: TenantContext,
  mailboxId: string,
  counterpart: string
): Promise<ContactWait | null> {
  if (!(await senderFlags(deps.db, ctx)).contactWait) return null;
  const hash = senderKeyHash(deps.credentialsKey, ctx.orgId, normalizeSenderAddress(counterpart));
  const { rows } = await sql<WaitRow>`
    SELECT median_their_reply_hours, reply_samples_theirs
    FROM sender_profiles
    WHERE org_id = ${ctx.orgId} AND mailbox_id = ${mailboxId}::uuid AND key_hash = ${hash}
  `.execute(deps.db);
  const row = rows[0];
  if (row === undefined) return null;
  const waitDays = contactWaitDays(row.median_their_reply_hours, row.reply_samples_theirs);
  if (waitDays === null || row.median_their_reply_hours === null) return null;
  return { waitDays, usualReplyDays: usualReplyDays(row.median_their_reply_hours) };
}
