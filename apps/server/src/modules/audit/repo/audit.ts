import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { AuditData, AuditEvent } from "./events";
import type { DbOrTrx } from "./shared";

// The type forbids nested data; this guard stops a cast or a JSON value that slips past it.
function assertFlatData(data: AuditData | undefined): void {
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === "object" && value !== null) {
      throw new TypeError(`audit data key ${key} is not flat`);
    }
  }
}
// A status change and its audit row go in one transaction: the caller passes `trx`.
export async function recordAudit(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<void> {
  assertFlatData(event.data);
  await db
    .insertInto("audit_log")
    .values({
      org_id: ctx.orgId,
      email_id: event.emailId ?? null,
      action_id: event.actionId ?? null,
      actor: event.actor,
      event: event.event,
      reason_code: event.reasonCode ?? null,
      data: JSON.stringify(event.data ?? {}),
      ...(event.at ? { created_at: event.at } : {}),
    })
    .execute();
}
// True when the organization has a row of any of these events.
export async function hasAuditEvent(db: DbOrTrx, ctx: TenantContext, events: readonly string[]): Promise<boolean> {
  const row = await db
    .selectFrom("audit_log")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("event", "in", [...events])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
// True when the organization has a row of this event with `data.key = key` (the dedup of the operator notices).
export async function hasAuditKey(db: DbOrTrx, ctx: TenantContext, event: string, key: string): Promise<boolean> {
  const row = await db
    .selectFrom("audit_log")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where(sql<string>`data->>'key'`, "=", key)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
// One row per organization and event: true when this call wrote it.
export async function recordAuditOnce(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<boolean> {
  assertFlatData(event.data);
  const result = await sql`
    INSERT INTO audit_log (org_id, email_id, action_id, actor, event, reason_code, data, created_at)
    SELECT ${ctx.orgId}, ${event.emailId ?? null}, ${event.actionId ?? null}, ${event.actor}, ${event.event},
      ${event.reasonCode ?? null}, ${JSON.stringify(event.data ?? {})}::jsonb, ${event.at ?? sql`now()`}
    WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE org_id = ${ctx.orgId} AND event = ${event.event})
  `.execute(db);
  return (result.numAffectedRows ?? 0n) > 0n;
}
// Rows of one event in the window `after < created_at <= until`, optionally of one `reason_code`.
export async function countEventsBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  range: { after: Date; until: Date },
  opts?: { reasonCode?: string }
): Promise<number> {
  let query = db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where("created_at", ">", range.after)
    .where("created_at", "<=", range.until);
  if (opts?.reasonCode !== undefined) query = query.where("reason_code", "=", opts.reasonCode);
  const row = await query.executeTakeFirstOrThrow();
  return Number(row.count);
}
// The rows of one event by one actor (a user id) after a time.
export async function countActorEventsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  actor: string,
  after: Date
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where("actor", "=", actor)
    .where("created_at", ">", after)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// As `countEventsBetween`, for the rows of one mailbox (`data.mailbox_id`).
export async function countMailboxEventsBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  mailboxId: string,
  range: { after: Date; until: Date }
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where("created_at", ">", range.after)
    .where("created_at", "<=", range.until)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// The rows of one event of one mailbox (`data.mailbox_id`) at or after `since` whose `data.outcome` is one of `outcomes`.
export async function countMailboxOutcomesSince(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  mailboxId: string,
  since: Date,
  outcomes: readonly string[]
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where(sql<string>`data->>'outcome'`, "in", [...outcomes])
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// The actor of the newest row of one event on one action; undefined when there is none.
export async function findActionActor(
  db: DbOrTrx,
  ctx: TenantContext,
  actionId: string,
  event: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("audit_log")
    .select("actor")
    .where("org_id", "=", ctx.orgId)
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.actor;
}
export interface AuditEventRow {
  id: string;
  at: Date;
  actor: string;
  event: string;
  reasonCode: string | null;
  data: unknown;
}
// The newest rows of the organization with an event in `events` and `created_at >= since`, newest first (created_at, then id).
// Index audit_log_org_event_created_idx (org_id, event, created_at) serves it. The security log and the operator notice list read through it.
export async function listAuditEvents(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { events: readonly string[]; since: Date; limit: number }
): Promise<AuditEventRow[]> {
  if (opts.events.length === 0) return [];
  const rows = await db
    .selectFrom("audit_log")
    .select(["id", "created_at", "actor", "event", "reason_code", "data"])
    .where("org_id", "=", ctx.orgId)
    .where("event", "in", [...opts.events])
    .where("created_at", ">=", opts.since)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    id: String(row.id),
    at: row.created_at,
    actor: row.actor,
    event: row.event,
    reasonCode: row.reason_code,
    data: row.data,
  }));
}
// The rows of `listAuditEvents` for every organization at once: the newest `perOrgLimit` rows of each organization, newest first
// (created_at, then id), each row with its `orgId`. One query (a window over the organization), not one per organization.
export async function listAuditEventsOfAll(
  db: DbOrTrx,
  opts: { events: readonly string[]; since: Date; perOrgLimit: number }
): Promise<(AuditEventRow & { orgId: string })[]> {
  if (opts.events.length === 0) return [];
  const rank = sql<string>`row_number() over (partition by org_id order by created_at desc, id desc)`;
  const rows = await db
    .selectFrom(
      db
        .selectFrom("audit_log")
        .select(["id", "org_id", "created_at", "actor", "event", "reason_code", "data", rank.as("rank")])
        .where("event", "in", [...opts.events])
        .where("created_at", ">=", opts.since)
        .as("ranked")
    )
    .select(["id", "org_id", "created_at", "actor", "event", "reason_code", "data"])
    .where("rank", "<=", String(opts.perOrgLimit))
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map((row) => ({
    id: String(row.id),
    orgId: row.org_id,
    at: row.created_at,
    actor: row.actor,
    event: row.event,
    reasonCode: row.reason_code,
    data: row.data,
  }));
}
