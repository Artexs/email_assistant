import type { Transaction } from "kysely";
import { sql } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// One sample run for each mailbox and quota day: the number of `sample` requests of the mailbox made since `since`.
export async function countSampleRequestsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<number> {
  const row = await db
    .selectFrom("reply_requests")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("trigger", "=", "sample")
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// One writer at a time for the sample run of a mailbox: the count of today's samples and the insert that follows must not interleave.
export async function lockSampleRun(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reply_samples:${ctx.orgId}:${mailboxId}`}, 0))`.execute(
    trx
  );
}

export interface SampleRequestView {
  id: string;
  status: string;
  reasonCode: string | null;
  subject: string | null;
  sampleBody: string | null;
}

// The `sample` requests of a mailbox made since `since`, oldest first, with the subject of their mail. The mail is joined with its
// own `org_id`.
export async function listSampleRequests(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<SampleRequestView[]> {
  const rows = await db
    .selectFrom("reply_requests as r")
    .innerJoin("emails", (join) => join.onRef("emails.id", "=", "r.email_id").onRef("emails.org_id", "=", "r.org_id"))
    .select(["r.id", "r.status", "r.reason_code", "r.sample_body", "emails.subject"])
    .where("r.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("r.mailbox_id", "=", mailboxId)
    .where("r.trigger", "=", "sample")
    .where("r.created_at", ">=", since)
    .orderBy("r.created_at")
    .orderBy("r.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    reasonCode: row.reason_code,
    subject: row.subject,
    sampleBody: row.sample_body,
  }));
}
