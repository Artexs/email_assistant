import { sql, type AnyColumnWithTable } from "kysely";

import { normalizedAddress, type DB, type TenantContext } from "../../../platform/db";

import {
  notAutomatic,
  senderScopeCondition,
  senderWindow,
  type SenderScope,
  type SenderWindowOptions,
} from "./sender-activity";
import type { DbOrTrx } from "./shared";

// Readers of the sender activity pass (`contacts`) over `sent_emails`: the user's Sent mail per recipient, and the incoming mail
// that the user answered. Every statement filters `org_id` and the mailbox. Addresses come back in the rule form and stay in
// memory: no reader logs an address or a count with an address.

// Column names as typed constants: a rename of a column fails the typecheck here, not a string in a statement. `a.a` is the
// element column of the lateral `unnest` (Postgres names it after the alias).
const TO = "sent_emails.to_addresses" satisfies AnyColumnWithTable<DB, "sent_emails">;
const CC = "sent_emails.cc_addresses" satisfies AnyColumnWithTable<DB, "sent_emails">;
const RECIPIENT = "a.a";

export interface SentCountsOptions {
  mailboxId: string;
  // Both ends are in the range of `internal_date`.
  since: Date;
  until: Date;
  only?: SenderScope;
}

export interface SentCount {
  // The recipient in the rule form.
  address: string;
  // The user's mails to this address, once per mail (an address in To and Cc of one mail counts once).
  mails: number;
  // The newest `internal_date` of those mails.
  lastAt: Date;
}

// The user's own mail (`origin = 'user'`, no system send, no automatic reply) to each To or Cc address that holds `@`, in the
// range. One statement for the whole mailbox.
export async function sentCountsByRecipient(
  db: DbOrTrx,
  ctx: TenantContext,
  options: SentCountsOptions
): Promise<SentCount[]> {
  const { mailboxId, since, until, only } = options;
  const address = normalizedAddress(RECIPIENT);
  const rows = await db
    .selectFrom("sent_emails")
    .innerJoinLateral(sql<{ a: string }>`unnest(${sql.ref(TO)} || ${sql.ref(CC)})`.as("a"), (join) => join.onTrue())
    .select(sql<string>`${address}`.as("address"))
    .select((eb) => [
      eb.fn.count("sent_emails.id").distinct().as("mails"),
      eb.fn.max("sent_emails.internal_date").$notNull().as("lastAt"),
    ])
    .where("sent_emails.org_id", "=", ctx.orgId)
    .where("sent_emails.mailbox_id", "=", mailboxId)
    .where("sent_emails.origin", "=", "user")
    .where("sent_emails.internal_date", ">=", since)
    .where("sent_emails.internal_date", "<=", until)
    .where(notAutomatic("sent_emails.auto_submitted"))
    .where("a.a", "like", "%@%")
    .$if(only !== undefined, (qb) => qb.where(senderScopeCondition(only as SenderScope, address)))
    .groupBy(address)
    .execute();
  return rows.map((row) => ({ address: row.address, mails: Number(row.mails), lastAt: row.lastAt }));
}

// The incoming mails of the window that the user answered with a Sent mail, whoever the reply went to (a reply goes to the
// Reply-To address, not always to the sender): a mail with a Message-ID that has a user Sent mail with `parent_message_id` = that
// Message-ID, not automatic, sent after the mail was received and at or after `since`. There is no upper bound on `sent_at`: a
// reply after `until` counts. An `EXISTS`, so a mail counts once however many replies it has.
export async function repliedBySentBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  window: SenderWindowOptions
): Promise<{ address: string; mails: number }[]> {
  const { mailboxId, since } = window;
  const rows = await db
    .with("win", () => senderWindow(db, ctx, window))
    .selectFrom("win as w")
    .select("w.address")
    .select((eb) => eb.fn.countAll().as("mails"))
    .where("w.message_id_header", "is not", null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("sent_emails as s")
          .select(sql<number>`1`.as("one"))
          .where("s.org_id", "=", ctx.orgId)
          .where("s.mailbox_id", "=", mailboxId)
          .where("s.origin", "=", "user")
          .whereRef("s.parent_message_id", "=", "w.message_id_header")
          .whereRef("s.sent_at", ">", "w.received_at")
          .where("s.sent_at", ">=", since)
          .where(notAutomatic("s.auto_submitted"))
      )
    )
    .groupBy("w.address")
    .execute();
  return rows.map((row) => ({ address: row.address, mails: Number(row.mails) }));
}
