import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// A reply send that has not ended: it waits for a tap, it was tapped and waits for the committer, or it is going out now.
export interface OpenReplySend {
  sendId: string;
  emailId: string;
  /** `received_at` of the mail that the reply answers. */
  receivedAt: Date;
  status: string;
}

const OPEN_REPLY_STATUSES = ["awaiting_approval", "approved", "applying"];

// The open reply sends of one thread of one mailbox (the mail of the send is in that mailbox and has that `thread_key`), oldest
// mail first. The drafter job calls it under the thread lock. Both joins and the filters hold `org_id`.
export async function listOpenReplySendsOfThread(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKey: string
): Promise<OpenReplySend[]> {
  const rows = await db
    .selectFrom("actions as a")
    .innerJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .select(["a.id as send_id", "e.id as email_id", "e.received_at", "a.status"])
    .where("a.org_id", "=", ctx.orgId)
    .where("a.type", "=", "send")
    .where("a.status", "in", OPEN_REPLY_STATUSES)
    .where(sql<string>`a.payload->>'kind'`, "=", "reply")
    .where("e.org_id", "=", ctx.orgId)
    .where("e.mailbox_id", "=", mailboxId)
    .where("e.thread_key", "=", threadKey)
    .orderBy("e.received_at")
    .orderBy("e.id")
    .execute();
  return rows.map((row) => ({
    sendId: row.send_id,
    emailId: row.email_id,
    receivedAt: row.received_at,
    status: row.status,
  }));
}
