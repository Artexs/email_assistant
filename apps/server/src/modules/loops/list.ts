import { localDateTime, localToInstant, nextLocalDate } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../platform/db";

import { toLoopRow, type DbOrTrx, type LoopKind, type LoopRow } from "./repo";

// Open rows of one mailbox in the given threads, all kinds, oldest due first.
export async function openLoopsByThread(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKeys: readonly string[]
): Promise<LoopRow[]> {
  if (threadKeys.length === 0) return [];
  const rows = await db
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "open")
    .where("thread_key", "in", [...threadKeys])
    .orderBy("due_at")
    .orderBy("id")
    .execute();
  return rows.map(toLoopRow);
}

export interface LoopCursor {
  dueAt: Date;
  id: string;
}

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

// The opaque `before` of a loop page: the `(due_at, id)` of the last row. Loop dates come from code with millisecond
// precision, so the ISO text keeps the value exact.
export function encodeLoopCursor(cursor: LoopCursor): string {
  return Buffer.from(`${cursor.dueAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeLoopCursor(text: string): LoopCursor | null {
  if (!CURSOR_PATTERN.test(text)) return null;
  const parts = Buffer.from(text, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const [dueText, id] = parts as [string, string];
  if (!z.uuid().safeParse(id).success) return null;
  const dueAt = new Date(dueText);
  if (Number.isNaN(dueAt.getTime()) || dueAt.toISOString() !== dueText) return null;
  return { dueAt, id };
}

export type LoopFilter = "open" | "due" | "closed";

// Oldest due first, then id. `open`: status open; `due`: open with a due date up to `now`; `closed`: status closed.
// `before` is the cursor of the last row of the page before. One more row is read to know if a next page exists.
export async function listLoops(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { kind?: LoopKind; filter: LoopFilter; now: Date; before?: LoopCursor; limit: number }
): Promise<{ items: LoopRow[]; next: string | null }> {
  const rows = await db
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .$if(opts.kind !== undefined, (qb) => qb.where("kind", "=", opts.kind as LoopKind))
    .$if(opts.filter === "closed", (qb) => qb.where("status", "=", "closed"))
    .$if(opts.filter !== "closed", (qb) => qb.where("status", "=", "open"))
    .$if(opts.filter === "due", (qb) => qb.where("due_at", "<=", opts.now))
    .$if(opts.before !== undefined, (qb) =>
      qb.where(sql<boolean>`(due_at, id) > (${opts.before?.dueAt}::timestamptz, ${opts.before?.id}::uuid)`)
    )
    .orderBy("due_at")
    .orderBy("id")
    .limit(opts.limit + 1)
    .execute();
  const items = rows.slice(0, opts.limit).map(toLoopRow);
  const last = items.at(-1);
  const next = rows.length > opts.limit && last ? encodeLoopCursor({ dueAt: last.due_at, id: last.id }) : null;
  return { items, next };
}

export interface BriefLoopSection {
  rows: LoopRow[];
  // All rows that match, also the ones the page cuts.
  total: number;
}

export interface BriefLoops {
  // Open `waiting` and `delegated` loops due by the end of the local day.
  waiting: BriefLoopSection;
  // Open `promised` loops due by the end of the local day.
  promised: BriefLoopSection;
  // Loops closed `stale` that the brief did not name yet.
  stale: BriefLoopSection;
}

const BRIEF_ROWS = 20;

// The loops for the brief of the given mailboxes, oldest due first. Only the org of `ctx`. "By the end of the
// local day": before the next local midnight, so an overdue loop is in the brief until it closes.
export async function briefLoopsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  opts: { now: Date; timeZone: string }
): Promise<BriefLoops> {
  if (mailboxIds.length === 0) {
    const empty: BriefLoopSection = { rows: [], total: 0 };
    return { waiting: empty, promised: empty, stale: empty };
  }
  const ids = [...mailboxIds];
  const dayEnd = localToInstant(nextLocalDate(localDateTime(opts.now, opts.timeZone).date), "00:00", opts.timeZone);
  const base = () => db.selectFrom("open_loops").where("org_id", "=", ctx.orgId).where("mailbox_id", "in", ids);
  const section = async (
    scope: (qb: ReturnType<typeof base>) => ReturnType<typeof base>,
    order: "due_at" | "closed_at"
  ): Promise<BriefLoopSection> => {
    const [rows, count] = await Promise.all([
      scope(base()).selectAll().orderBy(order).orderBy("id").limit(BRIEF_ROWS).execute(),
      scope(base())
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow(),
    ]);
    return { rows: rows.map(toLoopRow), total: Number(count.n) };
  };
  const [waiting, promised, stale] = await Promise.all([
    section(
      (qb) =>
        qb.where("status", "=", "open").where("kind", "in", ["waiting", "delegated"]).where("due_at", "<", dayEnd),
      "due_at"
    ),
    section(
      (qb) => qb.where("status", "=", "open").where("kind", "=", "promised").where("due_at", "<", dayEnd),
      "due_at"
    ),
    section(
      (qb) =>
        qb.where("status", "=", "closed").where("close_reason", "=", "stale").where("stale_notified_at", "is", null),
      "closed_at"
    ),
  ]);
  return { waiting, promised, stale };
}
