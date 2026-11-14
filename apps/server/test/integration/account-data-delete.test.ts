import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertLinkToken } from "../../src/modules/channels/repo";
import { insertEmail } from "../../src/modules/mail/repo";
import { insertDigest } from "../../src/modules/reports/repo";
import { upsertOrgFeature } from "../../src/modules/tenancy/repo";
import { tombstoneKeyHash } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { fillMailbox } from "./mailbox-rows";

// F106 stage 01: `delete_organization`, the tombstone table and the trigger `emails_skip_tombstoned`.
// The connection is the `app` role, with no tenant scope unless a test sets one.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;
interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

const NOW = new Date("2026-11-20T10:00:00Z");

async function rowCount(trx: Trx, table: string, column: string, id: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}::uuid`.execute(trx);
  return rows[0]?.n ?? 0;
}

// The seed of a table adds the row the table needs; `base` tables are filled by the shared fixtures.
type Seed = (trx: Trx, org: Org) => Promise<void>;

const base: Seed = () => Promise.resolve();

async function execute(trx: Trx, query: ReturnType<typeof sql>): Promise<void> {
  await query.execute(trx);
}

// One entry per public table that has an `org_id` or a `user_id` column (test 1 compares the keys with the catalog).
const DELETE_SEEDS: Record<string, Seed> = {
  action_feedback: async (trx, org) => {
    const ids = await actionIds(trx, org.orgId);
    await trx
      .insertInto("action_feedback")
      .values({ org_id: org.orgId, action_id: ids, kind: "mistake", via: "web", created_at: NOW, updated_at: NOW })
      .execute();
  },
  actions: base,
  audit_log: base,
  auth_accounts: (trx, org) =>
    execute(
      trx,
      sql`insert into auth_accounts (user_id, account_id, provider_id) values (${org.userId}::uuid, ${randomUUID()}, 'credential')`
    ),
  auth_lockouts: (trx, org) =>
    execute(trx, sql`insert into auth_lockouts (user_id, window_started_at) values (${org.userId}::uuid, ${NOW})`),
  auth_sessions: (trx, org) =>
    execute(
      trx,
      sql`insert into auth_sessions (user_id, token, expires_at) values (${org.userId}::uuid, ${randomUUID()}, ${NOW})`
    ),
  auth_two_factors: (trx, org) =>
    execute(
      trx,
      sql`insert into auth_two_factors (user_id, secret, backup_codes) values (${org.userId}::uuid, 's', 'b')`
    ),
  chat_link_tokens: async (trx, org) => {
    await insertLinkToken(
      trx,
      { orgId: org.orgId },
      {
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        userId: org.userId,
        expiresAt: new Date("2026-11-20T10:15:00Z"),
        createdAt: NOW,
      }
    );
  },
  chat_links: (trx, org) => linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), NOW),
  delegates: base,
  delegations: base,
  digests: async (trx, org) => {
    await insertDigest(
      trx,
      { orgId: org.orgId },
      {
        userId: org.userId,
        slotKey: "2026-11-20T08:00",
        periodStart: new Date("2026-11-19T16:00:00Z"),
        periodEnd: NOW,
      }
    );
  },
  dsr_tombstones: (trx, org) =>
    execute(
      trx,
      sql`insert into dsr_tombstones (org_id, key_hash) values (${org.orgId}::uuid, ${tombstoneKeyHash(`mid:<${randomUUID()}@x.test>:h1`)})`
    ),
  email_flags: async (trx, org) => {
    await trx
      .insertInto("email_flags")
      .values({
        email_id: await emailId(trx, org.orgId),
        org_id: org.orgId,
        seen: true,
        answered: false,
        flagged: false,
        checked_at: NOW,
      })
      .execute();
  },
  email_headers: async (trx, org) => {
    await trx
      .insertInto("email_headers")
      .values({ email_id: await emailId(trx, org.orgId), org_id: org.orgId, parts_known: true, captured_at: NOW })
      .execute();
  },
  emails: base,
  mailbox_credentials: base,
  mailbox_folders: base,
  mailbox_settings: base,
  mailboxes: base,
  memberships: base,
  org_features: async (trx, org) => {
    await upsertOrgFeature(trx, { orgId: org.orgId }, { flag: "stats_page", enabled: true, setBy: "cli", setAt: NOW });
  },
  outbox: base,
  sender_rules: base,
  triage_feedback: base,
  triage_results: base,
};

async function emailId(trx: Trx, orgId: string): Promise<string> {
  const row = await trx
    .selectFrom("emails")
    .select("id")
    .where("org_id", "=", orgId)
    .orderBy("id")
    .limit(1)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function actionIds(trx: Trx, orgId: string): Promise<string> {
  const row = await trx
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", orgId)
    .orderBy("id")
    .limit(1)
    .executeTakeFirstOrThrow();
  return row.id;
}

// The tables of the catalog with the column that ties a row to an organization or a user.
async function catalogTables(trx: Trx | typeof db): Promise<Map<string, string[]>> {
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name in ('org_id', 'user_id')
    order by 1, 2`.execute(trx);
  const tables = new Map<string, string[]>();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row.column_name]);
  return tables;
}

// An organization with an owner, a mailbox and one row in every table of DELETE_SEEDS, plus a reset token of the owner.
async function seedOrg(trx: Trx): Promise<Org> {
  const org = await createOrgWithMailbox(trx);
  await fillMailbox(trx, { orgId: org.orgId }, org.mailboxId, org.userId);
  for (const [table, seed] of Object.entries(DELETE_SEEDS)) {
    await seed(trx, org);
    const columns = (await catalogTables(trx)).get(table) ?? [];
    const own = columns.includes("org_id")
      ? await rowCount(trx, table, "org_id", org.orgId)
      : await rowCount(trx, table, "user_id", org.userId);
    if (own < 1) throw new Error(`seed of ${table} left no row`);
  }
  await sql`
    insert into auth_verifications (identifier, value, expires_at)
    values ('reset-password:x', ${org.userId}, ${NOW})`.execute(trx);
  return org;
}

const deleteOrganization = (trx: Trx, orgId: string) => sql`select delete_organization(${orgId}::uuid)`.execute(trx);

async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f106_case`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint f106_case`.execute(trx);
}

async function countsOf(trx: Trx, org: Org): Promise<Record<string, number>> {
  const tables = await catalogTables(trx);
  const counts: Record<string, number> = {};
  for (const [table, columns] of tables) {
    counts[table] = columns.includes("org_id")
      ? await rowCount(trx, table, "org_id", org.orgId)
      : await rowCount(trx, table, "user_id", org.userId);
  }
  const verifications = await trx
    .selectFrom("auth_verifications")
    .select(sql<number>`count(*)::int`.as("n"))
    .where("value", "=", org.userId)
    .executeTakeFirstOrThrow();
  counts.auth_verifications = verifications.n;
  return counts;
}

async function userCount(trx: Trx, userId: string): Promise<number> {
  return rowCount(trx, "users", "id", userId);
}

describe("delete_organization", () => {
  test("1: DELETE_SEEDS has one entry for every public table with org_id or user_id", async () => {
    const found = [...(await catalogTables(db)).keys()].sort();
    const missing = found.filter((table) => !(table in DELETE_SEEDS));
    if (missing.length > 0) {
      throw new Error(
        `table ${missing.join(", ")} has org_id or user_id but no seed in DELETE_SEEDS: add the seed here and make delete_organization remove its rows`
      );
    }
    expect(Object.keys(DELETE_SEEDS).sort()).toEqual(found);
  });

  // A foreign key of another name (`created_by REFERENCES users`) hides a table from test 1: walk the constraints.
  test("1b: every foreign key to organizations or users cascades or sets null, and its table is in DELETE_SEEDS", async () => {
    const { rows } = await sql<{ table_name: string; column_name: string; ref: string; rule: string }>`
      select c.conrelid::regclass::text as table_name, a.attname as column_name, c.confrelid::regclass::text as ref,
        c.confdeltype::text as rule
      from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and n.nspname = 'public' and c.confrelid in ('organizations'::regclass, 'users'::regclass)
      order by 1, 2`.execute(db);
    expect(rows.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const row of rows) {
      // c = CASCADE, n = SET NULL; a = NO ACTION, r = RESTRICT and d = SET DEFAULT would block or keep the delete.
      if (row.rule !== "c" && row.rule !== "n") {
        problems.push(
          `${row.table_name}.${row.column_name} references ${row.ref} without ON DELETE CASCADE or SET NULL`
        );
      }
      if (!(row.table_name in DELETE_SEEDS)) {
        problems.push(
          `${row.table_name}.${row.column_name} references ${row.ref} but ${row.table_name} is not in DELETE_SEEDS`
        );
      }
    }
    expect(problems).toEqual([]);
  });

  test("2: removes every row of the organization and of its owner; the other organization stays whole", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const beforeA = await countsOf(trx, A);
      const beforeB = await countsOf(trx, B);
      for (const [table, count] of Object.entries(beforeA)) {
        expect({ table, seeded: count >= 1 }).toEqual({ table, seeded: true });
      }

      await deleteOrganization(trx, A.orgId);

      const afterA = await countsOf(trx, A);
      for (const [table, count] of Object.entries(afterA)) expect({ table, count }).toEqual({ table, count: 0 });
      expect(await rowCount(trx, "organizations", "id", A.orgId)).toBe(0);
      expect(await userCount(trx, A.userId)).toBe(0);
      expect(await countsOf(trx, B)).toEqual(beforeB);
      expect(await userCount(trx, B.userId)).toBe(1);
      expect(await rowCount(trx, "organizations", "id", B.orgId)).toBe(1);
    });
  });

  test("3: a user with another membership keeps its row, its auth rows and the other membership", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const userU = await addMember(trx, A.orgId);
      await trx.insertInto("memberships").values({ org_id: B.orgId, user_id: userU, role: "assistant" }).execute();
      await sql`insert into auth_sessions (user_id, token, expires_at) values (${userU}::uuid, ${randomUUID()}, ${NOW})`.execute(
        trx
      );
      await sql`insert into auth_verifications (identifier, value, expires_at) values ('reset-password:u', ${userU}, ${NOW})`.execute(
        trx
      );

      await deleteOrganization(trx, A.orgId);

      expect(await userCount(trx, userU)).toBe(1);
      expect(await rowCount(trx, "auth_sessions", "user_id", userU)).toBe(1);
      const verifications = await sql<{ n: number }>`
        select count(*)::int as n from auth_verifications where value = ${userU}`.execute(trx);
      expect(verifications.rows[0]?.n).toBe(1);
      expect(await rowCount(trx, "memberships", "user_id", userU)).toBe(1);
      const own = await sql<{ n: number }>`
        select count(*)::int as n from memberships where user_id = ${userU}::uuid and org_id = ${A.orgId}::uuid`.execute(
        trx
      );
      expect(own.rows[0]?.n).toBe(0);
    });
  });

  test("4b: delete_organization is SECURITY DEFINER of migrator, executable by app only, with a fixed search_path", async () => {
    await withRollback(db, async (trx) => {
      const privilege = async (role: string) => {
        const { rows } = await sql<{ ok: boolean }>`
          select has_function_privilege(${role}, 'delete_organization(uuid)', 'EXECUTE') as ok`.execute(trx);
        return rows[0]?.ok;
      };
      expect(await privilege("public")).toBe(false);
      expect(await privilege("app")).toBe(true);
      const { rows } = await sql<{
        acl: string[] | null;
        prosecdef: boolean;
        owner: string;
        proconfig: string[] | null;
      }>`
        select proacl::text[] as acl, prosecdef, proowner::regrole::text as owner, proconfig
        from pg_proc where proname = 'delete_organization' and pronamespace = 'public'::regnamespace`.execute(trx);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.prosecdef).toBe(true);
      expect(row?.owner).toBe("migrator");
      expect(row?.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      for (const entry of row?.acl ?? []) expect(entry.startsWith("=")).toBe(false);
    });
  });

  test("4: an unknown organization id raises P0002", async () => {
    await withRollback(db, async (trx) => {
      await expectSqlState(trx, () => deleteOrganization(trx, randomUUID()), "P0002");
    });
  });

  test("5: with the tenant scope set to B, deleting A raises P0002 and A stays whole", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const beforeA = await countsOf(trx, A);
      await sql`select set_config('app.org_id', ${B.orgId}, true)`.execute(trx);
      await expectSqlState(trx, () => deleteOrganization(trx, A.orgId), "P0002");
      await sql`select set_config('app.org_id', '', true)`.execute(trx);
      expect(await countsOf(trx, A)).toEqual(beforeA);
    });
  });
});

describe("tombstones", () => {
  const newEmail = (mailboxId: string, dedupKey: string) => ({
    mailbox_id: mailboxId,
    dedup_key: dedupKey,
    message_id_header: null,
    content_hash: "h",
    uid: 1,
    source_folder: "INBOX",
    thread_key: `t:${dedupKey}`,
    from_address: "p@x.test",
    subject: "s",
    received_at: NOW,
  });
  const emailRows = async (trx: Trx, orgId: string, key: string) => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from emails where org_id = ${orgId}::uuid and dedup_key = ${key}`.execute(trx);
    return rows[0]?.n ?? 0;
  };

  test("6: insertEmail skips a tombstoned key and its #n copy; other keys and other organizations store", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const key = "mid:<t1@x.test>:h1";
      await sql`insert into dsr_tombstones (org_id, key_hash) values (${A.orgId}::uuid, ${tombstoneKeyHash(key)})`.execute(
        trx
      );
      const ctxA = { orgId: A.orgId };

      expect(await insertEmail(trx, ctxA, newEmail(A.mailboxId, key))).toBe(false);
      expect(await insertEmail(trx, ctxA, newEmail(A.mailboxId, `${key}#2`))).toBe(false);
      expect(await emailRows(trx, A.orgId, key)).toBe(0);
      expect(await emailRows(trx, A.orgId, `${key}#2`)).toBe(0);

      expect(await insertEmail(trx, { orgId: B.orgId }, newEmail(B.mailboxId, key))).toBe(true);
      expect(await insertEmail(trx, ctxA, newEmail(A.mailboxId, "mid:<other@x.test>:h1"))).toBe(true);
      expect(await emailRows(trx, B.orgId, key)).toBe(1);
      expect(await emailRows(trx, A.orgId, "mid:<other@x.test>:h1")).toBe(1);
    });
  });

  test("6b: tombstoneKeyHash equals the SQL value, and strips only a trailing #n", async () => {
    for (const key of ["mid:<a@x.test>:h1", "hash:abc", "mid:<a@x.test>:h1#2", "hash:a#b"]) {
      const { rows } = await sql<{ h: string }>`
        select encode(sha256(convert_to(regexp_replace(${key}::text, '#[0-9]+$', ''), 'UTF8')), 'hex') as h`.execute(
        db
      );
      expect({ key, hash: tombstoneKeyHash(key) }).toEqual({ key, hash: rows[0]?.h as string });
    }
    expect(tombstoneKeyHash("mid:<a@x.test>:h1#2")).toBe(tombstoneKeyHash("mid:<a@x.test>:h1"));
    expect(tombstoneKeyHash("hash:a#b")).not.toBe(tombstoneKeyHash("hash:a"));
  });

  test("9: every public table with dedup_key and message_id columns has the trigger", async () => {
    const { rows } = await sql<{ table_name: string }>`
      select c.table_name from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'dedup_key'
        and exists (
          select 1 from information_schema.columns m
          where m.table_schema = c.table_schema and m.table_name = c.table_name and m.column_name like 'message_id%')
      order by 1`.execute(db);
    expect(rows.length).toBeGreaterThan(0);
    for (const { table_name } of rows) {
      const triggers = await sql<{ n: number }>`
        select count(*)::int as n from information_schema.triggers
        where event_object_schema = 'public' and event_object_table = ${table_name}
          and trigger_name = 'emails_skip_tombstoned' and event_manipulation = 'INSERT'
          and action_timing = 'BEFORE'`.execute(db);
      if (triggers.rows[0]?.n !== 1) {
        throw new Error(`mail table ${table_name} has no emails_skip_tombstoned trigger: add it in its migration`);
      }
    }
  });
});
