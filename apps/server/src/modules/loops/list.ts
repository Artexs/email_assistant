import { localDateTime, nextLocalDate, startOfLocalDay } from "@ea/core";
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

// The first instant of the next local day: "by the end of the local day" means before it. A zone that repeats midnight in
// autumn (Havana) starts the day at the first 00:00; a zone that skips it in spring starts the day at the change.
export function endOfLocalDay(now: Date, timeZone: string): Date {
  return startOfLocalDay(nextLocalDate(localDateTime(now, timeZone).date), timeZone);
}

// The loops for the brief of the given mailboxes, oldest due first. Only the org of `ctx`. "By the end of the
// local day": before the next local midnight, so an overdue loop is in the brief until it closes.
export async function briefLoopsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  // `lock`: every row that the brief may name is read with `FOR UPDATE` in ONE pass ordered by id, the order `onSentOff` locks the open loops of a mailbox in (two orders would deadlock them); the sections are cut in memory (the caller is in
  // the queue transaction of a digest, which marks the rows and stores the text). Two effects: a second digest that runs at
  // the same time waits for the first and then sees `stale_notified_at` set, so a ⌛ line is named once; a command that closes a
  // loop (Sent tracking off, a tap) waits until the text is stored, so it finds the stored copy and can clear it.
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
  if (opts.lock === true) {
    const all = (
      await base()
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([eb("status", "=", "open"), eb("due_at", "<", dayEnd)]),
            eb.and([
              eb("status", "=", "closed"),
              eb("close_reason", "=", "stale"),
              eb("stale_notified_at", "is", null),
            ]),
          ])
        )
        .orderBy("id")
        .forUpdate()
        .execute()
    ).map(toLoopRow);
    const cut = (rows: LoopRow[], at: (row: LoopRow) => Date): BriefLoopSection => ({
      rows: [...rows]
        .sort((a, b) => at(a).getTime() - at(b).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, BRIEF_ROWS),
      total: rows.length,
    });
    const due = (row: LoopRow) => row.due_at;
    const closed = (row: LoopRow) => row.closed_at ?? row.updated_at;
    return {
      waiting: cut(
        all.filter((row) => row.status === "open" && row.kind !== "promised"),
        due
      ),
      promised: cut(
        all.filter((row) => row.status === "open" && row.kind === "promised"),
        due
      ),
      stale: cut(
        all.filter((row) => row.status === "closed"),
        closed
      ),
    };
  }
  const sections = [
    () =>
      section(
        (qb) =>
          qb.where("status", "=", "open").where("kind", "in", ["waiting", "delegated"]).where("due_at", "<", dayEnd),
        "due_at"
      ),
    () =>
      section(
        (qb) => qb.where("status", "=", "open").where("kind", "=", "promised").where("due_at", "<", dayEnd),
        "due_at"
      ),
    () =>
      section(
        (qb) =>
          qb.where("status", "=", "closed").where("close_reason", "=", "stale").where("stale_notified_at", "is", null),
        "closed_at"
      ),
  ] as const;
  const [waiting, promised, stale] = await Promise.all(sections.map((read) => read()));
  return {
    waiting: waiting as BriefLoopSection,
    promised: promised as BriefLoopSection,
    stale: stale as BriefLoopSection,
  };
}
