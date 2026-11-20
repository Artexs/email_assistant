import { normalizeAddress } from "@ea/core";
import { sql, type AnyColumnWithTable, type Expression, type SqlBool } from "kysely";

import { normalizedAddress, type DB, type TenantContext } from "../../../platform/db";
import type { TestMailRule } from "../seed";

import { mailKindFilter } from "./emails";
import { listMailboxes } from "./mailboxes";
import { notAutomaticSql, type DbOrTrx } from "./shared";

// Readers of the sender activity pass (`contacts`) over the tables of this module. Every statement filters `org_id` and the
// mailbox. Addresses come back in the rule form (`normalizedAddress` in SQL, `normalizeAddress` in `@ea/core`) and stay in
// memory: no reader logs an address or a count with an address.

// One address, or one registrable domain with its subdomains. The caller passes the address in the rule form.
export type SenderScope = { address: string } | { domain: string };

export interface SenderWindowOptions {
  mailboxId: string;
  // Both ends are in the window.
  since: Date;
  until: Date;
  testMail: TestMailRule;
  only?: SenderScope;
}

// Column names as typed constants: a rename of a column fails the typecheck here, not a string in a statement.
const FROM_ADDRESS = "emails.from_address_lower" satisfies AnyColumnWithTable<DB, "emails">;
const SENT_FROM = "sent_emails.from_address" satisfies AnyColumnWithTable<DB, "sent_emails">;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

// The condition of a scope on an address expression (the rule form). A domain scope is a prefilter (the host equals the domain
// or ends with `.domain`); the caller checks the exact registrable domain on the rows afterwards. Not exported by the module.
export function senderScopeCondition(only: SenderScope, address: Expression<unknown>): Expression<SqlBool> {
  if ("address" in only) return sql<SqlBool>`${address} = ${only.address}`;
  const domain = escapeLike(only.domain);
  return sql<SqlBool>`(${address} LIKE ${`%@${domain}`} OR ${address} LIKE ${`%.${domain}`})`;
}

// `Auto-Submitted` other than `no` marks an automatic mail (RFC 3834): this is the SQL test of the opposite. The column is a
// trusted name of this code. Not exported by the module.
export const notAutomatic = (column: string): Expression<SqlBool> => sql<SqlBool>`${sql.raw(notAutomaticSql(column))}`;

// The incoming mail of the window: real mail of this mailbox with a sender, received between `since` and `until`. The select is
// not executed here: a reader of this module or of triage embeds it as a CTE of its one statement. `address` is the sender in
// the rule form. `emails` has no alias, as `mailKindFilter` needs.
export function senderWindow(db: DbOrTrx, ctx: TenantContext, options: SenderWindowOptions) {
  const { mailboxId, since, until, testMail, only } = options;
  const address = normalizedAddress(FROM_ADDRESS);
  return db
    .selectFrom("emails")
    .select(["emails.id", "emails.received_at", "emails.message_id_header", "emails.in_reply_to"])
    .select(sql<string>`${address}`.as("address"))
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("emails.received_at", ">=", since)
    .where("emails.received_at", "<=", until)
    .where(FROM_ADDRESS, "is not", null)
    .where(FROM_ADDRESS, "<>", "")
    .$if(only !== undefined, (qb) => qb.where(senderScopeCondition(only as SenderScope, address)))
    .where(mailKindFilter("real", testMail));
}

export type SenderWindow = ReturnType<typeof senderWindow>;

export interface IncomingCounts {
  address: string;
  received: number;
  received30: number;
  answered: number;
  answered30: number;
  flagged: number;
  flagged30: number;
  // Mails received before `unseenBefore` that the user has not seen.
  unseen7d: number;
  // Mails whose captured headers are not cleared, and how many of them are bulk (List-Id, List-Unsubscribe or Auto-Submitted).
  headersKept: number;
  headersBulk: number;
  listId: boolean;
  listUnsubscribe: boolean;
  autoSubmitted: boolean;
  firstAt: Date;
  lastAt: Date;
}

// The counts of the incoming mail of the window per sender address, with its IMAP flags and captured headers. One statement for
// the whole mailbox. Flags and headers are left joins: a mail without a row counts as received only.
export async function incomingCountsBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  options: SenderWindowOptions & { since30: Date; unseenBefore: Date }
): Promise<IncomingCounts[]> {
  const { since30, unseenBefore } = options;
  const rows = await db
    .with("win", () => senderWindow(db, ctx, options))
    .selectFrom("win as w")
    .leftJoin("email_flags as f", (join) => join.onRef("f.email_id", "=", "w.id").on("f.org_id", "=", ctx.orgId))
    .leftJoin("email_headers as h", (join) => join.onRef("h.email_id", "=", "w.id").on("h.org_id", "=", ctx.orgId))
    .select((eb) => {
      // The captured headers of a mail count while their texts are not cleared.
      const kept = eb.and([eb("h.email_id", "is not", null), eb("h.texts_cleared_at", "is", null)]);
      const listId = eb.and([kept, eb(eb.fn("btrim", [eb.fn.coalesce("h.list_id", sql<string>`''`)]), "<>", "")]);
      const unsubscribe = eb.and([
        kept,
        eb(eb.fn("btrim", [eb.fn.coalesce("h.list_unsubscribe", sql<string>`''`)]), "<>", ""),
      ]);
      const automatic = eb.and([kept, eb.not(notAutomatic("h.auto_submitted"))]);
      const recent = eb("w.received_at", ">=", since30);
      return [
        "w.address",
        eb.fn.countAll().as("received"),
        eb.fn.countAll().filterWhere(recent).as("received30"),
        eb.fn.countAll().filterWhere("f.answered", "=", true).as("answered"),
        eb.fn
          .countAll()
          .filterWhere(eb.and([eb("f.answered", "=", true), recent]))
          .as("answered30"),
        eb.fn.countAll().filterWhere("f.flagged", "=", true).as("flagged"),
        eb.fn
          .countAll()
          .filterWhere(eb.and([eb("f.flagged", "=", true), recent]))
          .as("flagged30"),
        eb.fn
          .countAll()
          .filterWhere(eb.and([eb("f.seen", "=", false), eb("w.received_at", "<", unseenBefore)]))
          .as("unseen7d"),
        eb.fn.countAll().filterWhere(kept).as("headersKept"),
        eb.fn
          .countAll()
          .filterWhere(eb.or([listId, unsubscribe, automatic]))
          .as("headersBulk"),
        sql<boolean>`COALESCE(bool_or(${listId}), false)`.as("listId"),
        sql<boolean>`COALESCE(bool_or(${unsubscribe}), false)`.as("listUnsubscribe"),
        sql<boolean>`COALESCE(bool_or(${automatic}), false)`.as("autoSubmitted"),
        eb.fn.min("w.received_at").$notNull().as("firstAt"),
        eb.fn.max("w.received_at").$notNull().as("lastAt"),
      ];
    })
    .groupBy("w.address")
    .execute();
  return rows.map((row) => ({
    address: row.address,
    received: Number(row.received),
    received30: Number(row.received30),
    answered: Number(row.answered),
    answered30: Number(row.answered30),
    flagged: Number(row.flagged),
    flagged30: Number(row.flagged30),
    unseen7d: Number(row.unseen7d),
    headersKept: Number(row.headersKept),
    headersBulk: Number(row.headersBulk),
    listId: row.listId,
    listUnsubscribe: row.listUnsubscribe,
    autoSubmitted: row.autoSubmitted,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
  }));
}

// The own addresses of the mailbox: every mailbox address of the organization, and the From addresses of the Sent rows of this
// mailbox (aliases, `send as`; the `maxAliases` newest by send time). Rule form.
export async function ownAddressesOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  options: { maxAliases: number }
): Promise<Set<string>> {
  const own = new Set((await listMailboxes(db, ctx)).map((mailbox) => normalizeAddress(mailbox.address)));
  const address = normalizedAddress(SENT_FROM);
  const aliases = await db
    .selectFrom("sent_emails")
    .select(sql<string>`${address}`.as("address"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("from_address", "is not", null)
    .where((eb) => eb(eb.fn("btrim", ["from_address"]), "<>", ""))
    .groupBy(address)
    .orderBy((eb) => eb.fn.max("sent_at"), "desc")
    .orderBy(address)
    .limit(options.maxAliases)
    .execute();
  for (const row of aliases) own.add(row.address);
  return own;
}
