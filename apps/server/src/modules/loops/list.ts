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

// The first instant of the next local day: "by the end of the local day" means before it.
export function endOfLocalDay(now: Date, timeZone: string): Date {
  return localToInstant(nextLocalDate(localDateTime(now, timeZone).date), "00:00", timeZone);
}

// The loops for the brief of the given mailboxes, oldest due first. Only the org of `ctx`. "By the end of the
// local day": before the next local midnight, so an overdue loop is in the brief until it closes.
export async function briefLoopsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  // `lock`: every row that the brief may name is read with `FOR UPDATE`, in the order waiting, promised, stale (the caller is in
  // the queue transaction of a digest, which marks the rows and stores the text). Two effects: a second digest that runs at
  // the same time waits for the first and then sees `stale_notified_at` set, so a ⌛ line is named once; a command that closes a
  // loop (Sent tracking off, a tap) waits until the text is stored, so it finds the stored copy and can clear it (F116 stage 18).
  opts: { now: Date; timeZone: string; lock?: boolean }
): Promise<BriefLoops> {
  if (mailboxIds.length === 0) {
    const empty: BriefLoopSection = { rows: [], total: 0 };
    return { waiting: empty, promised: empty, stale: empty };
  }
  const ids = [...mailboxIds];
  const dayEnd = endOfLocalDay(opts.now, opts.timeZone);
  const base = () => db.selectFrom("open_loops").where("org_id", "=", ctx.orgId).where("mailbox_id", "in", ids);
  const section = async (
    scope: (qb: ReturnType<typeof base>) => ReturnType<typeof base>,
    order: "due_at" | "closed_at",
    lock = false
  ): Promise<BriefLoopSection> => {
    const rowsOf = () => {
      const query = scope(base()).selectAll().orderBy(order).orderBy("id").limit(BRIEF_ROWS);
      return (lock ? query.forUpdate() : query).execute();
    };
    const countOf = () =>
      scope(base())
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow();
    // A locked read comes first, so the count that follows sees what a concurrent digest committed.
    if (lock) {
      const rows = await rowsOf();
      const count = await countOf();
      return { rows: rows.map(toLoopRow), total: Number(count.n) };
    }
    const [rows, count] = await Promise.all([rowsOf(), countOf()]);
    return { rows: rows.map(toLoopRow), total: Number(count.n) };
  };
  const lock = opts.lock === true;
  const sections = [
    () =>
      section(
        (qb) =>
          qb.where("status", "=", "open").where("kind", "in", ["waiting", "delegated"]).where("due_at", "<", dayEnd),
        "due_at",
        lock
      ),
    () =>
      section(
        (qb) => qb.where("status", "=", "open").where("kind", "=", "promised").where("due_at", "<", dayEnd),
        "due_at",
        lock
      ),
    () =>
      section(
        (qb) =>
          qb.where("status", "=", "closed").where("close_reason", "=", "stale").where("stale_notified_at", "is", null),
        "closed_at",
        lock
      ),
  ] as const;
  // A locked read runs one section after the other: the lock order is the same in every digest.
  if (lock) {
    const waiting = await sections[0]();
    const promised = await sections[1]();
    const stale = await sections[2]();
    return { waiting, promised, stale };
  }
  const [waiting, promised, stale] = await Promise.all(sections.map((read) => read()));
  return {
    waiting: waiting as BriefLoopSection,
    promised: promised as BriefLoopSection,
    stale: stale as BriefLoopSection,
  };
}
