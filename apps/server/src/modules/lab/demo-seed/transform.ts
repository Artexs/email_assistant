import { DEMO_TABLES, TABLE_SPECS, type DemoRow, type DemoTable } from "./tables";
import { DemoSeedError, IMPORT_ORG_NAME, type DemoSeed } from "./types";

// The pure part of the import: a seed in, the rows of a new organization out. It reads no database and
// writes nothing, so a unit test runs it with a counter for new ids.

export interface ImportContext {
  /** The id of the new organization. */
  orgId: string;
  /** The id of the user that owns it; every user id of the seed becomes this one. */
  ownerId: string;
  now: Date;
  newId(): string;
}

export interface ImportRows {
  /** The rows to insert, in insert order; each table's rows have the parents of their own table first. */
  rows: Record<DemoTable, DemoRow[]>;
  /** The placeholder secret rows of the mailboxes. */
  credentials: DemoRow[];
  /** Outbox rows that are left out (not sent or failed, or an edit of such a row). */
  droppedOutbox: number;
}

/** The text of the secret of an imported mailbox. It is no valid ciphertext: no code can decrypt it and log in. */
export const PLACEHOLDER_SECRET = "demo-import-no-secret";

const FINAL_ACTION_STATUSES = new Set(["applied", "rejected", "expired", "undone", "logged", "failed"]);
const KEPT_OUTBOX_STATUSES = new Set(["sent", "failed"]);
const OPEN_EMAIL_STATUSES = new Set(["pending", "processing"]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Replaces every id of the map inside a text (an id alone, or inside `ap:<id>`). Another UUID stays. */
export function mapIdsInText(text: string, ids: ReadonlyMap<string, string>): string {
  return text.replace(UUID, (found) => ids.get(found.toLowerCase()) ?? found);
}

/** The same for a JSON value: every string in it, at any depth. Keys stay. */
export function mapIdsInJson(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return mapIdsInText(value, ids);
  if (Array.isArray(value)) return value.map((item) => mapIdsInJson(item, ids));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapIdsInJson(item, ids)]));
  }
  return value;
}

// Parents first inside one table; a cycle or a missing parent is a bad seed.
function parentsFirst(table: DemoTable, rows: DemoRow[]): DemoRow[] {
  const spec = TABLE_SPECS[table];
  const selfRefs = spec.selfRefs ?? [];
  const idColumn = spec.id;
  if (selfRefs.length === 0 || idColumn === undefined) return rows;
  const done = new Set<string>();
  const ordered: DemoRow[] = [];
  let waiting = rows;
  while (waiting.length > 0) {
    const ready = waiting.filter((row) =>
      selfRefs.every((column) => row[column] === null || done.has(String(row[column])))
    );
    if (ready.length === 0) throw new DemoSeedError("bad_seed", table);
    for (const row of ready) done.add(String(row[idColumn]));
    ordered.push(...ready);
    waiting = waiting.filter((row) => !ready.includes(row));
  }
  return ordered;
}

// Outbox rows that stay: sent or failed, and not an edit of a row that goes.
function keptOutbox(rows: DemoRow[]): DemoRow[] {
  let kept = rows.filter((row) => KEPT_OUTBOX_STATUSES.has(String(row.status)));
  for (;;) {
    const ids = new Set(kept.map((row) => String(row.id)));
    const next = kept.filter((row) => row.edit_of_outbox_id === null || ids.has(String(row.edit_of_outbox_id)));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/**
 * Builds the rows of the new organization from a seed that passed `checkDemoSeed`.
 * - every row id is new, every foreign key goes through the id map (a key that points outside its parent table is a
 *   bad seed), and every id inside a JSON column or a key column is mapped too (`audit_log.data.mailbox_id`,
 *   `actions.payload.delegation_id`);
 * - `org_id` is the new organization; every user id is the new owner;
 * - the mailboxes are `paused`; the placeholder secret goes with them;
 * - an action that is not final is `expired`; a mail that is still `pending` or `processing` is `skipped`;
 * - an outbox row that is not sent or failed is dropped.
 */
export function buildImportRows(seed: DemoSeed, ctx: ImportContext): ImportRows {
  // 1. The kept outbox rows decide which outbox ids exist.
  const source = { ...seed.tables, outbox: keptOutbox(seed.tables.outbox) };
  const droppedOutbox = seed.tables.outbox.length - source.outbox.length;

  // 2. The id map: every id of the file gets a new one; the old organization id and every user id map to the new ones.
  const ids = new Map<string, string>();
  const idsOf = new Map<DemoTable, Set<string>>();
  const oldOrgId = String(source.organizations[0]?.id);
  ids.set(oldOrgId.toLowerCase(), ctx.orgId);
  for (const table of DEMO_TABLES) {
    const spec = TABLE_SPECS[table];
    const own = new Set<string>();
    idsOf.set(table, own);
    for (const row of source[table]) {
      for (const column of spec.userRefs ?? []) {
        if (typeof row[column] === "string") ids.set(String(row[column]).toLowerCase(), ctx.ownerId);
      }
      if (spec.id === undefined) continue;
      const old = String(row[spec.id]).toLowerCase();
      // A repeated id, or a row id that is the organization id, would map two rows to one id.
      if (own.has(old) || (table !== "organizations" && old === oldOrgId.toLowerCase())) {
        throw new DemoSeedError("bad_seed", table, spec.id);
      }
      own.add(old);
      ids.set(old, table === "organizations" ? ctx.orgId : ctx.newId());
    }
  }

  // 3. The rows.
  const rows = {} as Record<DemoTable, DemoRow[]>;
  for (const table of DEMO_TABLES) {
    const spec = TABLE_SPECS[table];
    const built = source[table].map((row): DemoRow => {
      const next: DemoRow = { ...row };
      if (spec.id !== undefined) next[spec.id] = ids.get(String(row[spec.id]).toLowerCase());
      if (table !== "organizations") next.org_id = ctx.orgId;
      for (const [column, parent] of Object.entries(spec.refs)) {
        const value = row[column];
        if (value === null) continue;
        const mapped = idsOf.get(parent)?.has(String(value).toLowerCase()) === true;
        if (!mapped) throw new DemoSeedError("bad_seed", table, column);
        next[column] = ids.get(String(value).toLowerCase());
      }
      for (const column of spec.selfRefs ?? []) {
        const value = row[column];
        if (value === null) continue;
        if (idsOf.get(table)?.has(String(value).toLowerCase()) !== true)
          throw new DemoSeedError("bad_seed", table, column);
        next[column] = ids.get(String(value).toLowerCase());
      }
      for (const column of spec.userRefs ?? []) if (row[column] !== null) next[column] = ctx.ownerId;
      for (const column of spec.json) next[column] = mapIdsInJson(row[column], ids);
      for (const column of spec.idText ?? []) {
        if (typeof row[column] === "string") next[column] = mapIdsInText(row[column], ids);
      }
      const drop = new Set(spec.dropOnImport ?? []);
      return Object.fromEntries(Object.entries(next).filter(([column]) => !drop.has(column)));
    });
    rows[table] = parentsFirst(table, built);
  }

  // 4. Nothing of the demo may sync, send or run.
  const [org] = rows.organizations;
  if (org === undefined) throw new DemoSeedError("bad_seed", "organizations");
  Object.assign(org, {
    name: IMPORT_ORG_NAME,
    plan: "active",
    trial_ends_at: null,
    resumed_at: null,
    sso_required: false,
  });
  for (const row of rows.mailboxes) {
    Object.assign(row, {
      status: "paused",
      status_changed_at: ctx.now.toISOString(),
      auth_reason: null,
      oauth_provider: null,
      send_via: "smtp",
    });
  }
  for (const row of rows.emails) {
    if (!OPEN_EMAIL_STATUSES.has(String(row.status))) continue;
    Object.assign(row, { status: "skipped", skip_reason: "demo_import", locked_at: null, next_attempt_at: null });
  }
  for (const row of rows.actions) {
    if (FINAL_ACTION_STATUSES.has(String(row.status))) continue;
    Object.assign(row, {
      status: "expired",
      status_reason: "demo_import",
      locked_at: null,
      next_attempt_at: null,
      send_started_at: null,
    });
  }
  const credentials = rows.mailboxes.map(
    (row): DemoRow => ({
      mailbox_id: row.id,
      org_id: ctx.orgId,
      secret_kind: "password",
      encrypted_secret: PLACEHOLDER_SECRET,
      key_version: 1,
    })
  );
  return { rows, credentials, droppedOutbox };
}
