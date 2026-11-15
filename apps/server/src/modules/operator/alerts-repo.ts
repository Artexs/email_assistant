import type { SloKind } from "@ea/core";

import type { Db } from "../../platform/db";
import { HardError } from "../../platform/errors";

// F114: the open state of operator alerts. The table `ops_alerts` has no `org_id`: it is host-wide state (disk, backup)
// and holds codes and numbers only. These functions take no `TenantContext`; the exception is listed in
// `docs/code-patterns.md` § Data access.

export type OpsAlertRow = {
  id: string;
  kind: SloKind;
  openedAt: Date;
  openSentAt: Date | null;
  lastSentAt: Date | null;
  noticeCount: number;
  resolvedAt: Date | null;
  resolvedSentAt: Date | null;
  facts: Record<string, number>;
};

export type AlertPhase = "open" | "repeat" | "resolved";

const MAX_FACTS = 20;
const FACT_KEY = /^[a-z][a-z0-9_]{0,39}$/;

// `facts` hold numbers only: a snake_case key and a finite number. Anything else would put text (and maybe personal
// data) into a table that the privacy lists treat as free of it.
function factsJson(facts: Record<string, number>): string {
  const keys = Object.keys(facts);
  if (keys.length > MAX_FACTS) throw new HardError("ops_alerts facts: too many keys");
  for (const key of keys) {
    if (!FACT_KEY.test(key)) throw new HardError("ops_alerts facts: a key is not snake_case");
    const value: unknown = facts[key];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new HardError("ops_alerts facts: a value is not a number");
  }
  return JSON.stringify(facts);
}

const COLUMNS = [
  "id",
  "kind",
  "opened_at",
  "open_sent_at",
  "last_sent_at",
  "notice_count",
  "resolved_at",
  "resolved_sent_at",
  "facts",
] as const;

type RawRow = {
  id: string;
  kind: string;
  opened_at: Date;
  open_sent_at: Date | null;
  last_sent_at: Date | null;
  notice_count: number;
  resolved_at: Date | null;
  resolved_sent_at: Date | null;
  facts: unknown;
};

function toRow(raw: RawRow): OpsAlertRow {
  return {
    id: String(raw.id),
    kind: raw.kind as SloKind,
    openedAt: raw.opened_at,
    openSentAt: raw.open_sent_at,
    lastSentAt: raw.last_sent_at,
    noticeCount: raw.notice_count,
    resolvedAt: raw.resolved_at,
    resolvedSentAt: raw.resolved_sent_at,
    facts: raw.facts as Record<string, number>,
  };
}

/** The incident of the kind that is not closed (`resolved_sent_at IS NULL`), or null. */
export async function getActiveAlert(db: Db, kind: SloKind): Promise<OpsAlertRow | null> {
  const row = await db
    .selectFrom("ops_alerts")
    .select(COLUMNS)
    .where("kind", "=", kind)
    .where("resolved_sent_at", "is", null)
    .executeTakeFirst();
  return row ? toRow(row) : null;
}

/** Inserts a new incident. When the kind has an active one, returns that row and writes nothing. */
export async function openAlert(
  db: Db,
  input: { kind: SloKind; at: Date; facts: Record<string, number> }
): Promise<OpsAlertRow> {
  const facts = factsJson(input.facts);
  // Two tries: the active row can close between the conflict and the read.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inserted = await db
      .insertInto("ops_alerts")
      .values({ kind: input.kind, opened_at: input.at, facts })
      .onConflict((oc) => oc.column("kind").where("resolved_sent_at", "is", null).doNothing())
      .returning(COLUMNS)
      .executeTakeFirst();
    if (inserted) return toRow(inserted);
    const existing = await getActiveAlert(db, input.kind);
    if (existing) return existing;
  }
  throw new HardError("ops_alerts: no active row and no insert");
}

/** Marks a sent notice. `open` and `repeat` count it; `resolved` closes the incident. */
export async function markAlertSent(
  db: Db,
  id: string,
  phase: AlertPhase,
  at: Date,
  facts: Record<string, number>
): Promise<void> {
  const json = factsJson(facts);
  const query = db.updateTable("ops_alerts").where("id", "=", id);
  if (phase === "open") {
    await query
      .set((eb) => ({ open_sent_at: at, last_sent_at: at, notice_count: eb("notice_count", "+", 1), facts: json }))
      .execute();
  } else if (phase === "repeat") {
    await query.set((eb) => ({ last_sent_at: at, notice_count: eb("notice_count", "+", 1), facts: json })).execute();
  } else {
    await query
      .set((eb) => ({ resolved_sent_at: at, resolved_at: eb.fn.coalesce("resolved_at", eb.val(at)), facts: json }))
      .execute();
  }
}

/** Closes the incident. `silent` also sets `resolved_sent_at`: no notice was sent, so none is owed. */
export async function resolveAlert(
  db: Db,
  id: string,
  at: Date,
  facts: Record<string, number>,
  options: { silent: boolean }
): Promise<void> {
  const json = factsJson(facts);
  await db
    .updateTable("ops_alerts")
    .set((eb) => ({
      resolved_at: eb.fn.coalesce("resolved_at", eb.val(at)),
      facts: json,
      ...(options.silent ? { resolved_sent_at: at } : {}),
    }))
    .where("id", "=", id)
    .where("resolved_sent_at", "is", null)
    .execute();
}

/** Incidents opened at or after `since`, newest first. */
export async function listAlerts(db: Db, input: { since: Date; limit: number }): Promise<OpsAlertRow[]> {
  const rows = await db
    .selectFrom("ops_alerts")
    .select(COLUMNS)
    .where("opened_at", ">=", input.since)
    .orderBy("opened_at", "desc")
    .orderBy("id", "desc")
    .limit(input.limit)
    .execute();
  return rows.map(toRow);
}
