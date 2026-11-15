import type { TenantContext } from "../../../platform/db";
import type { TestMailRule } from "../seed";

import { mailKindFilter } from "./emails";
import type { DbOrTrx } from "./shared";

// The most sender addresses one run reads for one mailbox: a mailbox with more distinct senders in 24 h is not a person's inbox.
export const WAITING_SENDER_LIMIT = 2000;

export interface WaitingQuery {
  // Pending mail received at or after this time.
  receivedSince: Date;
  // `false`: every mail of the mailbox. A rule: test mail only (the triage scope `synthetic`).
  syntheticOnly: false | { testMail: TestMailRule };
}

// The distinct lower-case sender addresses of the pending mail of one mailbox. It uses `emails_mailbox_sender_idx`.
export async function listWaitingSenders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  query: WaitingQuery
): Promise<string[]> {
  let select = db
    .selectFrom("emails")
    .select("from_address_lower")
    .distinct()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "pending")
    .where("received_at", ">=", query.receivedSince)
    .where("from_address_lower", "is not", null);
  if (query.syntheticOnly !== false) select = select.where(mailKindFilter("synthetic", query.syntheticOnly.testMail));
  const rows = await select.limit(WAITING_SENDER_LIMIT).execute();
  return rows.flatMap((row) => (row.from_address_lower === null ? [] : [row.from_address_lower]));
}

export interface WaitingMail {
  id: string;
  mailboxId: string;
  fromAddress: string;
  receivedAt: Date;
}

// The pending mail of one mailbox from these lower-case senders, oldest first.
export async function listWaitingFromSenders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  senders: readonly string[],
  query: WaitingQuery
): Promise<WaitingMail[]> {
  if (senders.length === 0) return [];
  let select = db
    .selectFrom("emails")
    .select(["id", "mailbox_id", "from_address", "received_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "pending")
    .where("received_at", ">=", query.receivedSince)
    .where("from_address_lower", "in", [...senders]);
  if (query.syntheticOnly !== false) select = select.where(mailKindFilter("synthetic", query.syntheticOnly.testMail));
  const rows = await select.orderBy("received_at").orderBy("id").execute();
  return rows.flatMap((row) =>
    row.from_address === null
      ? []
      : [{ id: row.id, mailboxId: row.mailbox_id, fromAddress: row.from_address, receivedAt: row.received_at }]
  );
}
