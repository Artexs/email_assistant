import { sql, type AnyColumnWithTable, type Expression } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { normalizedAddress } from "../../../platform/db";

import { notAutomatic, senderWindow, type SenderWindowOptions } from "./sender-activity";
import type { DbOrTrx } from "./shared";

// Readers of the reply delays of the sender activity pass (`contacts`) over the tables of this module. Each is one statement for
// the whole mailbox; every table of it filters `org_id` and the mailbox. Addresses come back in the rule form and stay in memory.

export interface ReplyDelays {
  address: string;
  samples: number;
  medianHours: number;
}

// Column names as typed constants: a rename of a column fails the typecheck here, not a string in a statement.
const TO_ADDRESSES = "sent_emails.to_addresses" satisfies AnyColumnWithTable<DB, "sent_emails">;
const CC_ADDRESSES = "sent_emails.cc_addresses" satisfies AnyColumnWithTable<DB, "sent_emails">;
const AUTO_SUBMITTED = "sent_emails.auto_submitted" satisfies AnyColumnWithTable<DB, "sent_emails">;

// `count(*)` of the samples and the median of the delay in hours, per address. A delay of 0 or less, or above `maxHours`, is no sample.
const sampleCount = sql<number>`count(*)::int`;
const median = (hours: Expression<number>) => sql<number>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${hours})`;

// The user's delay: for each mail of the window, the first user Sent mail (by send time, then id) whose `parent_message_id` is the
// Message-ID of the mail, that is not automatic, was sent after the mail was received and at or after `window.since`, and that goes
// to the sender of the mail (To or Cc) or has no stored recipient. One sample per mail, of the hours from receipt to that reply.
// Edge rule: the read has no upper bound on `sent_at` (a reply after `window.until` counts); `window.until` bounds the mail only.
// A delay of 0 or less (clock skew) is no sample.
export async function userReplyDelaysBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  window: SenderWindowOptions,
  options: { maxHours: number }
): Promise<ReplyDelays[]> {
  const recipients = sql`${sql.ref(TO_ADDRESSES)} || ${sql.ref(CC_ADDRESSES)}`;
  const rows = await db
    .with("win", () => senderWindow(db, ctx, window))
    .selectFrom((eb) =>
      eb
        .selectFrom("win as w")
        .innerJoinLateral(
          (lateral) =>
            lateral
              .selectFrom("sent_emails")
              .select("sent_emails.sent_at")
              .where("sent_emails.org_id", "=", ctx.orgId)
              .where("sent_emails.mailbox_id", "=", window.mailboxId)
              .where("sent_emails.origin", "=", "user")
              .whereRef("sent_emails.parent_message_id", "=", "w.message_id_header")
              .whereRef("sent_emails.sent_at", ">", "w.received_at")
              .where("sent_emails.sent_at", ">=", window.since)
              .where(notAutomatic(AUTO_SUBMITTED))
              .where(
                sql<boolean>`(cardinality(${recipients}) = 0 OR EXISTS (
                  SELECT 1 FROM unnest(${recipients}) AS r(x) WHERE ${normalizedAddress("r.x")} = w.address
                ))`
              )
              .orderBy("sent_emails.sent_at")
              .orderBy("sent_emails.id")
              .limit(1)
              .as("r"),
          (join) => join.onTrue()
        )
        .select(["w.address", sql<number>`extract(epoch FROM (r.sent_at - w.received_at)) / 3600`.as("hours")])
        .as("d")
    )
    .select(["d.address", sampleCount.as("samples"), median(sql<number>`d.hours`).as("medianHours")])
    .where("d.hours", ">", 0)
    .where("d.hours", "<=", options.maxHours)
    .groupBy("d.address")
    .execute();
  return rows.map((row) => ({ address: row.address, samples: row.samples, medianHours: row.medianHours }));
}

const MESSAGE_ID = "sent_emails.message_id" satisfies AnyColumnWithTable<DB, "sent_emails">;

// The ids that the In-Reply-To header of the window mail names (first 2000 characters): the `<id>` tokens when there are any, else
// the bare words. A whole id, as `replyMatch` does.
const namedIds = sql<string[]>`COALESCE(
  NULLIF(ARRAY(SELECT m[1] FROM regexp_matches(left(w.in_reply_to, 2000), '<([^<>[:space:]]+)>', 'g') AS m), '{}'),
  ARRAY(
    SELECT x FROM unnest(regexp_split_to_array(btrim(left(w.in_reply_to, 2000)), '[[:space:]]+')) AS x
    WHERE x <> '' AND x !~ '[<>]'
  )
)`;

// Their delay: the time from a user Sent mail to the incoming mail of the window that names its Message-ID in In-Reply-To. One
// sample per incoming mail, of the newest user Sent mail (before the mail; the smaller id wins a tie on time) that it names.
// Edge rule: the Sent set has no Auto-Submitted filter and no date bound. A delay above `maxHours` is no sample.
// Both CTEs are MATERIALIZED: the planner then builds the Sent set and the named ids once, whatever the table statistics say.
export async function theirReplyDelaysBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  window: SenderWindowOptions,
  options: { maxHours: number }
): Promise<ReplyDelays[]> {
  const rows = await db
    .with("win", () => senderWindow(db, ctx, window))
    .with(
      (cte) => cte("own_sent").materialized(),
      (qb) =>
        qb
          .selectFrom("sent_emails")
          .select(["sent_emails.id", "sent_emails.sent_at"])
          .select(sql<string>`regexp_replace(btrim(${sql.ref(MESSAGE_ID)}), '^<|>$', '', 'g')`.as("ref"))
          .where("sent_emails.org_id", "=", ctx.orgId)
          .where("sent_emails.mailbox_id", "=", window.mailboxId)
          .where("sent_emails.origin", "=", "user")
          .where("sent_emails.message_id", "is not", null)
    )
    .with(
      (cte) => cte("named").materialized(),
      (qb) =>
        qb
          .selectFrom("win as w")
          .innerJoinLateral(sql<{ id: string }>`unnest(${namedIds})`.as<"t">(sql`t(id)`), (join) => join.onTrue())
          .select(["w.id", "w.address as addr", "w.received_at", "t.id as ref"])
          .where("w.in_reply_to", "is not", null)
    )
    .selectFrom((eb) =>
      eb
        .selectFrom("named as n")
        .innerJoin("own_sent as s", (join) =>
          join.onRef("s.ref", "=", "n.ref").onRef("s.sent_at", "<", "n.received_at")
        )
        .distinctOn("n.id")
        .select(["n.addr", sql<number>`extract(epoch FROM (n.received_at - s.sent_at)) / 3600`.as("hours")])
        .orderBy("n.id")
        .orderBy("s.sent_at", "desc")
        .orderBy("s.id")
        .as("d")
    )
    .select(["d.addr as address", sampleCount.as("samples"), median(sql<number>`d.hours`).as("medianHours")])
    .where("d.hours", ">", 0)
    .where("d.hours", "<=", options.maxHours)
    .groupBy("d.addr")
    .execute();
  return rows.map((row) => ({ address: row.address, samples: row.samples, medianHours: row.medianHours }));
}
