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

// The mails (of `emailIds`) that have an open reply send: the "Draft reply" button is not shown for them. Filters `org_id`.
export async function listOpenReplyEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Set<string>> {
  if (emailIds.length === 0) return new Set();
  const rows = await db
    .selectFrom("actions")
    .select("email_id")
    .distinct()
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", OPEN_REPLY_STATUSES)
    .where(sql<string>`payload->>'kind'`, "=", "reply")
    .where("email_id", "in", [...emailIds])
    .execute();
  return new Set(rows.flatMap((row) => (row.email_id === null ? [] : [row.email_id])));
}

// An open reply send that the sweep may close.
export interface SweepReplySend {
  sendId: string;
  emailId: string;
  /** `awaiting_approval`, or `approved` that no committer holds. */
  status: "awaiting_approval" | "approved";
  /** The `folder` of the draft payload: where the mail was when the draft was made. Null when the draft is gone or has none. */
  draftFolder: string | null;
  createdAt: Date;
}

// The reply sends of one mailbox that no run holds: `awaiting_approval`, or `approved` with no `locked_at` (the user tapped Send and
// the committer has not taken it). An `applying` send and an `approved` one under a lock are the committer's. Oldest send first, at
// most `limit`. The joins and the filters hold `org_id`.
export async function listSweepReplySends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number }
): Promise<SweepReplySend[]> {
  const rows = await db
    .selectFrom("actions as a")
    .innerJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .leftJoin("actions as d", (join) =>
      join.onRef("d.id", "=", "a.depends_on_action_id").onRef("d.org_id", "=", "a.org_id")
    )
    .select([
      "a.id as send_id",
      "a.email_id",
      "a.status",
      "a.created_at",
      sql<string | null>`d.payload->>'folder'`.as("draft_folder"),
    ])
    .where("a.org_id", "=", ctx.orgId)
    .where("a.type", "=", "send")
    .where(sql<string>`a.payload->>'kind'`, "=", "reply")
    .where((eb) =>
      eb.or([
        eb("a.status", "=", "awaiting_approval"),
        eb.and([eb("a.status", "=", "approved"), eb("a.locked_at", "is", null)]),
      ])
    )
    .where("e.org_id", "=", ctx.orgId)
    .where("e.mailbox_id", "=", mailboxId)
    .orderBy("a.created_at")
    .orderBy("a.id")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.email_id === null || (row.status !== "awaiting_approval" && row.status !== "approved")
      ? []
      : [
          {
            sendId: row.send_id,
            emailId: row.email_id,
            status: row.status,
            draftFolder: row.draft_folder,
            createdAt: row.created_at,
          },
        ]
  );
}

// The mailboxes that hold at least one reply send that the sweep may look at (same states as `listSweepReplySends`), with the creation time
// of the oldest such send. The oldest mailbox comes first, then the mailbox id: the sweep visits the mailbox with the longest wait first, and
// a mailbox with nothing to sweep is not in the list. It reads every organization (a job path, like `listSyncTargets`); the caller
// then works under the context of each organization. Every join ties `org_id`.
export async function listMailboxesWithOpenReplySends(
  db: DbOrTrx
): Promise<{ orgId: string; mailboxId: string; oldestAt: Date }[]> {
  const rows = await db
    .selectFrom("actions as a")
    .innerJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .select(["e.org_id", "e.mailbox_id", (eb) => eb.fn.min("a.created_at").as("oldest_at")])
    .where("a.type", "=", "send")
    .where(sql<string>`a.payload->>'kind'`, "=", "reply")
    .where((eb) =>
      eb.or([
        eb("a.status", "=", "awaiting_approval"),
        eb.and([eb("a.status", "=", "approved"), eb("a.locked_at", "is", null)]),
      ])
    )
    .groupBy(["e.org_id", "e.mailbox_id"])
    .orderBy("oldest_at")
    .orderBy("e.mailbox_id")
    .execute();
  return rows.flatMap((row) =>
    row.oldest_at === null ? [] : [{ orgId: row.org_id, mailboxId: row.mailbox_id, oldestAt: row.oldest_at }]
  );
}
