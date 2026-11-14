import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { recordAudit } from "../../src/modules/audit";
import { insertLinkToken } from "../../src/modules/channels/repo";
import { insertSenderRule } from "../../src/modules/config";
import { insertDigest } from "../../src/modules/reports/repo";
import { upsertOrgFeature } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { fillMailbox } from "./mailbox-rows";

// Policy tests of F092 (spec/features/active/F092-rls-safety-net/plan.md D8–D13). The connection is the `app` role.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const TENANT_TABLES = [
  "actions",
  "audit_log",
  "chat_link_tokens",
  "chat_links",
  "delegates",
  "delegations",
  "digests",
  "emails",
  "mailbox_credentials",
  "mailbox_folders",
  "mailbox_settings",
  "mailboxes",
  "memberships",
  "org_features",
  "outbox",
  "sender_rules",
  "triage_feedback",
  "triage_results",
];
const ALL_POLICY_TABLES = [...TENANT_TABLES, "organizations"];

// The text Postgres stores for the policy (plan P9).
const POLICY_TEXT = "((app_current_org() IS NULL) OR (org_id = app_current_org()))";
const ORG_POLICY_TEXT = "((app_current_org() IS NULL) OR (id = app_current_org()))";

const NOW = new Date("2026-11-20T10:00:00Z");

type Trx = Transaction<DB>;

// Local to the transaction only (plan D18); "" means no scope.
async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

async function seedOrg(trx: Trx): Promise<{ orgId: string; userId: string; mailboxId: string }> {
  const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
  await fillMailbox(trx, { orgId }, mailboxId, userId);
  await linkChat(trx, { orgId }, userId, randomChatId(), NOW);
  await insertLinkToken(
    trx,
    { orgId },
    {
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      userId,
      expiresAt: new Date("2026-11-20T10:15:00Z"),
      createdAt: NOW,
    }
  );
  await insertDigest(
    trx,
    { orgId },
    {
      userId,
      slotKey: "2026-11-20T08:00",
      periodStart: new Date("2026-11-19T16:00:00Z"),
      periodEnd: NOW,
    }
  );
  await upsertOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: true, setBy: "cli", setAt: NOW });
  return { orgId, userId, mailboxId };
}

const columnOf = (table: string): "org_id" | "id" => (table === "organizations" ? "id" : "org_id");

async function countWhere(trx: Trx, table: string, column: "org_id" | "id", orgId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${orgId}`.execute(trx);
  return rows[0]?.n ?? 0;
}

async function countOthers(trx: Trx, table: string, column: "org_id" | "id", orgId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} <> ${orgId}`.execute(trx);
  return rows[0]?.n ?? 0;
}

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f092_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f092_case`.execute(trx);
}

const deleteMailbox = (trx: Trx, orgId: string, mailboxId: string) =>
  sql`select delete_mailbox(${orgId}::uuid, ${mailboxId}::uuid)`.execute(trx);

async function mailboxCount(trx: Trx, mailboxId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from mailboxes where id = ${mailboxId}::uuid`.execute(trx);
  return rows[0]?.n ?? 0;
}

describe("catalog walk", () => {
  test("1: every table with org_id is in TENANT_TABLES, and the list has no other table", async () => {
    const { rows } = await sql<{ relname: string }>`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attname = 'org_id' and not a.attisdropped
      order by 1`.execute(db);
    const found = rows.map((row) => row.relname);
    for (const table of found) {
      if (!TENANT_TABLES.includes(table)) {
        throw new Error(
          `table ${table} has org_id but no entry here: add the tenant_rows policy in its migration and the table to TENANT_TABLES (docs/code-patterns.md § Data access)`
        );
      }
    }
    for (const table of TENANT_TABLES) {
      expect(found).toContain(table);
    }
  });

  test("2: RLS is on and not forced on every policy table", async () => {
    for (const table of ALL_POLICY_TABLES) {
      const { rows } = await sql<{ on: boolean; forced: boolean }>`
        select c.relrowsecurity as on, c.relforcerowsecurity as forced from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = ${table}`.execute(db);
      expect({ table, ...rows[0] }).toEqual({ table, on: true, forced: false });
    }
  });

  test("3: each policy table has exactly the one tenant_rows policy", async () => {
    for (const table of ALL_POLICY_TABLES) {
      const text = table === "organizations" ? ORG_POLICY_TEXT : POLICY_TEXT;
      const { rows } = await sql<{
        policyname: string;
        permissive: string;
        roles: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>`
        select policyname, permissive, array_to_string(roles, ',') as roles, cmd, qual, with_check
        from pg_policies where schemaname = 'public' and tablename = ${table}`.execute(db);
      expect({ table, rows }).toEqual({
        table,
        rows: [
          {
            policyname: "tenant_rows",
            permissive: "PERMISSIVE",
            roles: "app",
            cmd: "ALL",
            qual: text,
            with_check: text,
          },
        ],
      });
    }
  });

  test("4: the tables with RLS on are exactly the policy tables", async () => {
    const { rows } = await sql<{ relname: string }>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      order by 1`.execute(db);
    expect(rows.map((row) => row.relname)).toEqual([...ALL_POLICY_TABLES].sort());
  });

  test("5: every SECURITY DEFINER function checks the scope", async () => {
    const { rows } = await sql<{ proname: string; prosrc: string }>`
      select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef order by 1`.execute(db);
    expect(rows.map((row) => row.proname)).toContain("delete_mailbox");
    for (const row of rows) {
      expect({ name: row.proname, scoped: row.prosrc.includes("app_current_org()") }).toEqual({
        name: row.proname,
        scoped: true,
      });
    }
  });

  test("19: every view has security_invoker, and there is no materialized view", async () => {
    const views = await sql<{ relname: string; options: string | null }>`
      select c.relname, array_to_string(c.reloptions, ',') as options from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' order by 1`.execute(db);
    for (const view of views.rows) {
      const options = (view.options ?? "").split(",");
      if (!options.includes("security_invoker=true") && !options.includes("security_invoker=on")) {
        throw new Error(
          `view ${view.relname} must be created WITH (security_invoker = true), or must not exist (docs/code-patterns.md § Data access)`
        );
      }
    }
    const matviews = await sql<{ relname: string }>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'm' order by 1`.execute(db);
    expect(matviews.rows.map((row) => row.relname)).toEqual([]);
  });
});

describe("isolation", () => {
  test("6: with no scope both organizations are visible in every table", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      await scopeLocal(trx, "");
      for (const table of ALL_POLICY_TABLES) {
        const column = columnOf(table);
        expect({ table, a: (await countWhere(trx, table, column, A.orgId)) >= 1 }).toEqual({ table, a: true });
        expect({ table, b: (await countWhere(trx, table, column, B.orgId)) >= 1 }).toEqual({ table, b: true });
      }
    });
  });

  test("7: under the scope of A no table shows a row of B", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      await scopeLocal(trx, A.orgId);
      for (const table of ALL_POLICY_TABLES) {
        const column = columnOf(table);
        expect({ table, b: await countWhere(trx, table, column, B.orgId) }).toEqual({ table, b: 0 });
        expect({ table, a: (await countWhere(trx, table, column, A.orgId)) >= 1 }).toEqual({ table, a: true });
        expect({ table, others: await countOthers(trx, table, column, A.orgId) }).toEqual({ table, others: 0 });
      }
    });
  });

  test("8: an empty scope in the same transaction shows B again", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      await scopeLocal(trx, A.orgId);
      expect(await countWhere(trx, "mailboxes", "org_id", B.orgId)).toBe(0);
      await scopeLocal(trx, "");
      expect(await countWhere(trx, "mailboxes", "org_id", B.orgId)).toBe(1);
    });
  });

  test("9: app_current_org() follows the setting", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await scopeLocal(trx, A.orgId);
      const scoped = await sql<{ v: string | null }>`select app_current_org() as v`.execute(trx);
      expect(scoped.rows[0]?.v).toBe(A.orgId);
      await scopeLocal(trx, "");
      const open = await sql<{ v: string | null }>`select app_current_org() as v`.execute(trx);
      expect(open.rows[0]?.v).toBeNull();
    });
  });

  test("10: a setting that is not a uuid fails closed", async () => {
    await withRollback(db, async (trx) => {
      await scopeLocal(trx, "not-a-uuid");
      await expectSqlState(trx, () => sql`select count(*) from mailboxes`.execute(trx), "22P02");
    });
  });
});

describe("writes", () => {
  async function seedTwo(trx: Trx) {
    const A = await seedOrg(trx);
    const B = await seedOrg(trx);
    await scopeLocal(trx, A.orgId);
    return { A, B };
  }

  test("11: an insert for B under the scope of A is refused", async () => {
    await withRollback(db, async (trx) => {
      const { B } = await seedTwo(trx);
      await expectSqlState(
        trx,
        () => insertSenderRule(trx, { orgId: B.orgId }, { mailboxId: null, pattern: "w11@x.test", kind: "vip" }),
        "42501"
      );
    });
  });

  test("12: an update that moves a row of A to B is refused", async () => {
    await withRollback(db, async (trx) => {
      const { A, B } = await seedTwo(trx);
      await scopeLocal(trx, "");
      await insertSenderRule(trx, { orgId: A.orgId }, { mailboxId: null, pattern: "w12@x.test", kind: "vip" });
      await scopeLocal(trx, A.orgId);
      await expectSqlState(
        trx,
        () => sql`update sender_rules set org_id = ${B.orgId}::uuid where pattern = 'w12@x.test'`.execute(trx),
        "42501"
      );
    });
  });

  test("13: update and delete of a row of B change nothing under the scope of A", async () => {
    await withRollback(db, async (trx) => {
      const { A, B } = await seedTwo(trx);
      await scopeLocal(trx, "");
      await insertSenderRule(trx, { orgId: B.orgId }, { mailboxId: null, pattern: "w13@x.test", kind: "vip" });
      await scopeLocal(trx, A.orgId);
      const updated = await sql`update sender_rules set kind = 'blocklist' where pattern = 'w13@x.test'`.execute(trx);
      expect(updated.numAffectedRows).toBe(0n);
      const deleted = await sql`delete from sender_rules where pattern = 'w13@x.test'`.execute(trx);
      expect(deleted.numAffectedRows).toBe(0n);
      await scopeLocal(trx, "");
      const { rows } = await sql<{ kind: string }>`select kind from sender_rules where pattern = 'w13@x.test'`.execute(
        trx
      );
      expect(rows).toEqual([{ kind: "vip" }]);
    });
  });

  test("14: an audit row for A under the scope of A is written", async () => {
    await withRollback(db, async (trx) => {
      const { A } = await seedTwo(trx);
      await recordAudit(trx, { orgId: A.orgId }, { actor: "system", event: "email.triaged" });
      expect(await countWhere(trx, "audit_log", "org_id", A.orgId)).toBeGreaterThanOrEqual(1);
    });
  });

  test("15: an audit row for B under the scope of A is refused", async () => {
    await withRollback(db, async (trx) => {
      const { B } = await seedTwo(trx);
      await expectSqlState(
        trx,
        () => recordAudit(trx, { orgId: B.orgId }, { actor: "system", event: "email.triaged" }),
        "42501"
      );
    });
  });

  test("16: delete_mailbox refuses the mailbox of B under the scope of A", async () => {
    await withRollback(db, async (trx) => {
      const { B } = await seedTwo(trx);
      await expectSqlState(trx, () => deleteMailbox(trx, B.orgId, B.mailboxId), "P0002");
      await scopeLocal(trx, "");
      expect(await mailboxCount(trx, B.mailboxId)).toBe(1);
    });
  });

  test("17: delete_mailbox deletes the own mailbox under the scope of A", async () => {
    await withRollback(db, async (trx) => {
      const { A } = await seedTwo(trx);
      await deleteMailbox(trx, A.orgId, A.mailboxId);
      await scopeLocal(trx, "");
      expect(await mailboxCount(trx, A.mailboxId)).toBe(0);
    });
  });

  test("18: delete_mailbox with no scope deletes any mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { B } = await seedTwo(trx);
      await scopeLocal(trx, "");
      await deleteMailbox(trx, B.orgId, B.mailboxId);
      expect(await mailboxCount(trx, B.mailboxId)).toBe(0);
    });
  });
});
