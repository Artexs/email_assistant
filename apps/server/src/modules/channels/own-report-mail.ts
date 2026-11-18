import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// The `X-EA-Action-Id` of a mail is the id of a report mail that this system appended to this mailbox (ADR 0022 point 2): the mail is the
// system's own, so no sync, backfill or rescan stores, triages or samples it. Any sender can write the header, so a value that is not a
// uuid never reaches the query, and only an outbox row of this organization with `channel = 'mail'` and this mailbox counts: the id of a
// Telegram row, of a draft or of another mailbox's report mail does not make a foreign mail "own".
export async function isOwnReportMail(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  id: string
): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const row = await db
    .selectFrom("outbox")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("channel", "=", "mail")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return row !== undefined;
}
