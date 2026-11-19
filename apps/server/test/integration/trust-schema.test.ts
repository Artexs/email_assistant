import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addMailbox, insertCheckItemRow, insertCheckRow, insertTripRow } from "./trust-fixtures";

// The migration `trust_ladder` (`docs/capabilities/trust.md`): CHECKs, keys,
// row-level security as the app role, and the Up and Down sections as the table owner.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

const migration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115180001_trust_ladder.sql"),
  "utf8"
);
const up = migration.split("-- migrate:down")[0] ?? "";
const down = migration.split("-- migrate:down")[1] ?? "";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f110_schema_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f110_schema_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

async function insertOutboxRaw(
  trx: Trx,
  o: { orgId: string; userId: string },
  values: { kind: string; channel?: string; mailboxId?: string }
): Promise<string> {
  const at = new Date("2026-11-15T10:00:00Z");
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      kind: values.kind,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: at,
      created_at: at,
      mailbox_id: values.mailboxId ?? null,
      ...(values.channel === undefined ? {} : { channel: values.channel }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function setMember(trx: Trx, o: { orgId: string; userId: string }, values: Record<string, unknown>) {
  await trx
    .updateTable("memberships")
    .set(values)
    .where("org_id", "=", o.orgId)
    .where("user_id", "=", o.userId)
    .execute();
}

describe("history_checks", () => {
  test("the value lists and the no_result pair", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      for (const status of ["backfilling", "waiting_flags", "classifying", "queued"] as const) {
        await insertCheckRow(trx, o, await addMailbox(trx, o), { status });
      }
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { status: "running" }), CHECK);
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { reason: "timer" }), CHECK);
      await expectSqlState(
        trx,
        () => insertCheckRow(trx, o, o.mailboxId, { status: "no_result", no_result_reason: "tired" }),
        CHECK
      );
      // `no_result` needs a reason, and only `no_result` has one.
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { status: "no_result" }), CHECK);
      await expectSqlState(
        trx,
        () => insertCheckRow(trx, o, o.mailboxId, { status: "done", no_result_reason: "stopped" }),
        CHECK
      );
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { cost_usd: "-1" }), CHECK);
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { result: JSON.stringify([]) }), CHECK);
      await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { key: JSON.stringify("x") }), CHECK);
      for (const reason of ["connect", "cli", "web", "model_switch", "flag_on"] as const) {
        await insertCheckRow(trx, o, o.mailboxId, { status: "done", reason });
      }
      for (const why of [
        "no_history",
        "uidvalidity",
        "cost_unknown",
        "stopped",
        "key_changed",
        "auth_refused",
        "model_failing",
      ] as const) {
        await insertCheckRow(trx, o, o.mailboxId, { status: "no_result", no_result_reason: why });
      }
    });
  });

  test("one open check per mailbox: every open status conflicts; done and no_result do not", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertCheckRow(trx, o, o.mailboxId, { status: "queued" });
      for (const status of ["queued", "backfilling", "waiting_flags", "classifying"] as const) {
        await expectSqlState(trx, () => insertCheckRow(trx, o, o.mailboxId, { status }), UNIQUE);
      }
      await insertCheckRow(trx, o, o.mailboxId, { status: "done" });
      await insertCheckRow(trx, o, o.mailboxId, { status: "done" });
      await insertCheckRow(trx, o, o.mailboxId, { status: "no_result", no_result_reason: "no_history" });
      // The open check ends: the next one fits.
      await sql`update history_checks set status = 'done' where mailbox_id = ${o.mailboxId}::uuid and status = 'queued'`.execute(
        trx
      );
      await insertCheckRow(trx, o, o.mailboxId, { status: "backfilling" });
    });
  });

  test("a check needs a mailbox of its own organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => insertCheckRow(trx, a, b.mailboxId), FOREIGN_KEY);
    });
  });
});

describe("history_check_items", () => {
  test("the lists, the key, and the keys of the same organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const check = await insertCheckRow(trx, a, a.mailboxId);
      const email = await insertTestEmail(trx, a, a.mailboxId);
      const foreignEmail = await insertTestEmail(trx, b, b.mailboxId);
      await insertCheckItemRow(trx, a, check, email);
      await expectSqlState(trx, () => insertCheckItemRow(trx, a, check, email), UNIQUE);
      for (const bad of [{ category: "other" }, { source: "guess" }, { confidence: 1.5 }, { confidence: -0.1 }]) {
        const fresh = await insertTestEmail(trx, a, a.mailboxId);
        await expectSqlState(trx, () => insertCheckItemRow(trx, a, check, fresh, bad), CHECK);
      }
      // A mail of another organization does not fit, and neither does a check of another organization.
      await expectSqlState(trx, () => insertCheckItemRow(trx, a, check, foreignEmail), FOREIGN_KEY);
      const foreignCheck = await insertCheckRow(trx, b, b.mailboxId);
      await expectSqlState(trx, () => insertCheckItemRow(trx, a, foreignCheck, email), FOREIGN_KEY);
      for (const source of ["triage_result", "classified", "rule"] as const) {
        await insertCheckItemRow(trx, a, check, await insertTestEmail(trx, a, a.mailboxId), { source });
      }
    });
  });
});

describe("autonomy_trips", () => {
  test("the lists, the counts object and the unique grant", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertTripRow(trx, o, o.mailboxId);
      await expectSqlState(trx, () => insertTripRow(trx, o, o.mailboxId), UNIQUE);
      await expectSqlState(trx, () => insertTripRow(trx, o, o.mailboxId, { category: "delegation" }), CHECK);
      await expectSqlState(trx, () => insertTripRow(trx, o, o.mailboxId, { category: "unsure" }), CHECK);
      await expectSqlState(trx, () => insertTripRow(trx, o, o.mailboxId, { reason: "bored" }), CHECK);
      await expectSqlState(trx, () => insertTripRow(trx, o, o.mailboxId, { counts: JSON.stringify([1]) }), CHECK);
      for (const [n, reason] of (
        ["corrections", "important_hidden", "model_switch", "evidence_changed", "history_fail"] as const
      ).entries()) {
        await insertTripRow(trx, o, o.mailboxId, {
          reason,
          category: "spam",
          granted_at: new Date(1_700_000_000_000 + n),
        });
      }
      for (const category of ["urgent", "needs_reply", "notification"] as const) {
        await insertTripRow(trx, o, o.mailboxId, { category });
      }
    });
  });
});

describe("memberships: quiet hours and report settings", () => {
  test("the time format, the pair and the channel list", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await setMember(trx, o, { quiet_start: "22:00", quiet_end: "07:00" });
      await setMember(trx, o, { quiet_start: "00:00", quiet_end: "23:59" });
      await setMember(trx, o, { quiet_start: "07:30", quiet_end: "07:30" });
      await setMember(trx, o, { quiet_start: null, quiet_end: null });
      for (const bad of ["24:00", "7:00", "09:60", "ab:cd", "22:00:00", " 22:00", "22:00\n"]) {
        await expectSqlState(trx, () => setMember(trx, o, { quiet_start: bad, quiet_end: "07:00" }), CHECK);
        await expectSqlState(trx, () => setMember(trx, o, { quiet_start: "22:00", quiet_end: bad }), CHECK);
      }
      await expectSqlState(trx, () => setMember(trx, o, { quiet_start: "22:00", quiet_end: null }), CHECK);
      await expectSqlState(trx, () => setMember(trx, o, { quiet_start: null, quiet_end: "07:00" }), CHECK);
      for (const channel of ["telegram", "mail", "both"]) await setMember(trx, o, { report_channel: channel });
      await expectSqlState(trx, () => setMember(trx, o, { report_channel: "sms" }), CHECK);
      await expectSqlState(trx, () => setMember(trx, o, { report_channel: null }), "23502");
    });
  });

  test("a new membership has no quiet hours, the telegram channel and no report mailbox", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const row = await trx
        .selectFrom("memberships")
        .select(["quiet_start", "quiet_end", "report_channel", "report_mailbox_id"])
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ quiet_start: null, quiet_end: null, report_channel: "telegram", report_mailbox_id: null });
    });
  });

  test("the report mailbox is a mailbox of the same organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await setMember(trx, a, { report_mailbox_id: a.mailboxId });
      await expectSqlState(trx, () => setMember(trx, a, { report_mailbox_id: b.mailboxId }), FOREIGN_KEY);
    });
  });
});

describe("outbox: new kinds and the mail channel", () => {
  test("each new kind and channel mail pass; an unknown kind or channel still fails", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertOutboxRaw(trx, o, { kind: "trust_report_ready" });
      await insertOutboxRaw(trx, o, { kind: "autonomy_paused" });
      await insertOutboxRaw(trx, o, { kind: "weekly_report", channel: "mail" });
      await insertOutboxRaw(trx, o, { kind: "trust_report_ready", channel: "mail" });
      await insertOutboxRaw(trx, o, { kind: "autonomy_paused", channel: "telegram" });
      await expectSqlState(trx, () => insertOutboxRaw(trx, o, { kind: "x" }), CHECK);
      await expectSqlState(trx, () => insertOutboxRaw(trx, o, { kind: "autonomy_paused", channel: "sms" }), CHECK);
      await expectSqlState(trx, () => insertOutboxRaw(trx, o, { kind: "autonomy_paused", channel: "" }), CHECK);
    });
  });

  test("the kind list only widens: every kind of the list before the migration is still in it", async () => {
    const before = readFileSync(
      join(import.meta.dir, "../../../../db/migrations/20261115150001_outbox_sent_missing.sql"),
      "utf8"
    );
    const listOf = (text: string): string[] => {
      const match = /outbox_kind_check CHECK \(kind IN \(([^)]*)\)\)/.exec(text.split("-- migrate:down")[0] ?? "");
      return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "");
    };
    const oldKinds = listOf(before);
    const newKinds = listOf(up);
    expect(oldKinds.length).toBeGreaterThan(15);
    expect(newKinds.filter((kind) => !oldKinds.includes(kind))).toEqual(["trust_report_ready", "autonomy_paused"]);
    expect(oldKinds.filter((kind) => !newKinds.includes(kind))).toEqual([]);
    // The Down list is the old one.
    expect(listOf(`${down.replace("-- migrate:down", "")}`.replace(/^/, "-- migrate:up\n"))).toEqual(oldKinds);
  });
});

describe("row-level security as the app role", () => {
  test("under the scope of org B, the rows of org A are invisible and cannot be written, changed or deleted", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const email = await insertTestEmail(trx, a, a.mailboxId);
      const check = await insertCheckRow(trx, a, a.mailboxId);
      await insertCheckItemRow(trx, a, check, email);
      await insertTripRow(trx, a, a.mailboxId);
      const bCheck = await insertCheckRow(trx, b, b.mailboxId);

      await scopeLocal(trx, b.orgId);
      const seen = async (table: "history_checks" | "history_check_items" | "autonomy_trips") => {
        const rows = await trx.selectFrom(table).select("org_id").execute();
        return rows.map((row) => row.org_id);
      };
      expect(await seen("history_checks")).toEqual([b.orgId]);
      expect(await seen("history_check_items")).toEqual([]);
      expect(await seen("autonomy_trips")).toEqual([]);

      // A write for A is refused; a change or a delete of A's rows touches nothing.
      await expectSqlState(trx, () => insertCheckRow(trx, a, a.mailboxId, { status: "done" }), RLS);
      await expectSqlState(trx, () => insertCheckItemRow(trx, a, check, email, { category: "spam" }), RLS);
      await expectSqlState(trx, () => insertTripRow(trx, a, a.mailboxId, { category: "spam" }), RLS);
      const changed = await trx
        .updateTable("history_checks")
        .set({ attempts: 9 })
        .where("id", "=", check)
        .returning("id")
        .execute();
      expect(changed).toEqual([]);
      const removed = await trx.deleteFrom("autonomy_trips").where("org_id", "=", a.orgId).returning("id").execute();
      expect(removed).toEqual([]);
      // B changes its own row: allowed. B cannot move its row to org A.
      await trx.updateTable("history_checks").set({ attempts: 1 }).where("id", "=", bCheck).execute();
      await expectSqlState(
        trx,
        () => trx.updateTable("history_checks").set({ org_id: a.orgId }).where("id", "=", bCheck).execute(),
        RLS
      );

      // Back to A: the rows are all there.
      await scopeLocal(trx, a.orgId);
      expect(await seen("history_checks")).toEqual([a.orgId]);
      expect(await seen("history_check_items")).toEqual([a.orgId]);
      expect(await seen("autonomy_trips")).toEqual([a.orgId]);
    });
  });

  test("the three tables have the tenant_rows policy for the app role and row-level security on", async () => {
    const { rows } = await sql<{ relname: string; rls: boolean; policy: string | null; roles: string[] | null }>`
      select c.relname, c.relrowsecurity as rls, p.polname as policy,
        (select array_agg(r.rolname::text) from pg_roles r where r.oid = any (p.polroles)) as roles
      from pg_class c left join pg_policy p on p.polrelid = c.oid
      where c.relname in ('history_checks', 'history_check_items', 'autonomy_trips') order by 1`.execute(db);
    expect(rows).toEqual([
      { relname: "autonomy_trips", rls: true, policy: "tenant_rows", roles: ["app"] },
      { relname: "history_check_items", rls: true, policy: "tenant_rows", roles: ["app"] },
      { relname: "history_checks", rls: true, policy: "tenant_rows", roles: ["app"] },
    ]);
  });
});

interface Shape {
  tables: number;
  memberColumns: number;
  memberConstraints: number;
  kindHasNew: boolean;
  channelHasMail: boolean;
  indexes: number;
}

async function shape(trx: Trx): Promise<Shape> {
  const { rows } = await sql<{
    tables: number;
    member_columns: number;
    member_constraints: number;
    kind_has_new: boolean;
    channel_has_mail: boolean;
    indexes: number;
  }>`
    select
      (select count(*) from pg_class where relname in ('history_checks', 'history_check_items', 'autonomy_trips') and relkind = 'r')::int as tables,
      (select count(*) from information_schema.columns where table_name = 'memberships'
        and column_name in ('quiet_start', 'quiet_end', 'report_channel', 'report_mailbox_id'))::int as member_columns,
      (select count(*) from pg_constraint where conrelid = 'memberships'::regclass
        and conname in ('memberships_quiet_pair_check', 'memberships_report_mailbox_fkey'))::int as member_constraints,
      (select pg_get_constraintdef(oid) like '%autonomy_paused%' from pg_constraint where conname = 'outbox_kind_check') as kind_has_new,
      (select pg_get_constraintdef(oid) like '%mail%' from pg_constraint where conname = 'outbox_channel_check') as channel_has_mail,
      (select count(*) from pg_indexes where indexname in
        ('history_checks_open_key', 'history_check_items_email_idx', 'memberships_report_mailbox_idx'))::int as indexes`.execute(
    trx
  );
  const row = rows[0];
  if (row === undefined) throw new Error("no shape row");
  return {
    tables: row.tables,
    memberColumns: row.member_columns,
    memberConstraints: row.member_constraints,
    kindHasNew: row.kind_has_new,
    channelHasMail: row.channel_has_mail,
    indexes: row.indexes,
  };
}

// The Up and Down sections run inside a transaction (DDL is transactional) as the table owner and roll back, so the
// shared test DB keeps its schema.
describe("migration: Up, Down, Up", () => {
  const WITH = {
    tables: 3,
    memberColumns: 4,
    memberConstraints: 2,
    kindHasNew: true,
    channelHasMail: true,
    indexes: 3,
  };
  const WITHOUT = {
    tables: 0,
    memberColumns: 0,
    memberConstraints: 0,
    kindHasNew: false,
    channelHasMail: false,
    indexes: 0,
  };

  async function withOwner(run: (owner: ReturnType<typeof createDb>) => Promise<void>): Promise<void> {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      await run(owner);
    } finally {
      await owner.destroy();
    }
  }

  test("Down drops the new objects and the new notices, keeps every old row; Up adds them again", async () => {
    expect(up).not.toMatch(/DROP\s+(TABLE|COLUMN)|RENAME|ALTER\s+COLUMN/i);
    await withOwner(async (owner) => {
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        await setMember(trx, o, { report_channel: "mail", quiet_start: "21:00", quiet_end: "06:00" });
        const kept = await insertOutboxRaw(trx, o, { kind: "auth_error", mailboxId: o.mailboxId });
        const keptDigest = await insertOutboxRaw(trx, o, { kind: "sent_missing", mailboxId: o.mailboxId });
        const gone1 = await insertOutboxRaw(trx, o, { kind: "trust_report_ready" });
        const gone2 = await insertOutboxRaw(trx, o, { kind: "autonomy_paused" });
        const gone3 = await insertOutboxRaw(trx, o, { kind: "weekly_report", channel: "mail" });
        expect(await shape(trx)).toEqual(WITH);

        await sql.raw(down).execute(trx);
        expect(await shape(trx)).toEqual(WITHOUT);
        const left = await trx.selectFrom("outbox").select("id").where("org_id", "=", o.orgId).execute();
        expect(left.map((row) => row.id).sort()).toEqual([kept, keptDigest].sort());
        expect([gone1, gone2, gone3].some((id) => left.some((row) => row.id === id))).toBe(false);
        // The old rules are back.
        await expectSqlState(trx, () => insertOutboxRaw(trx, o, { kind: "trust_report_ready" }), CHECK);
        await expectSqlState(
          trx,
          () => insertOutboxRaw(trx, o, { kind: "auth_error", channel: "mail", mailboxId: o.mailboxId }),
          CHECK
        );

        await sql.raw(up).execute(trx);
        expect(await shape(trx)).toEqual(WITH);
        const member = await trx
          .selectFrom("memberships")
          .select(["report_channel", "quiet_start"])
          .where("org_id", "=", o.orgId)
          .where("user_id", "=", o.userId)
          .executeTakeFirstOrThrow();
        // The columns are new again: the old values went with the Down.
        expect(member).toEqual({ report_channel: "telegram", quiet_start: null });
        await insertOutboxRaw(trx, o, { kind: "trust_report_ready", channel: "mail" });
        // Row-level security and its policy are back on the new tables (the owner cannot switch to `app`; the rows
        // are checked as `app` in the tests above).
        const policies = await sql<{ n: number }>`
          select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
          where c.relname in ('history_checks', 'history_check_items', 'autonomy_trips') and c.relrowsecurity`.execute(
          trx
        );
        expect(policies.rows[0]?.n).toBe(3);
      });
    });
  });
});
