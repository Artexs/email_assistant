import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMembership } from "../../src/modules/tenancy/repo";
import { createDb, type DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { addMember, createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The migration `20261118130001_push_devices.sql` (the table `push_subscriptions`, the column
// `outbox.push_subscription_id`, the channel `push` and the column `memberships.notice_routes`). The connection is the `app`
// role; the Down and Up sections run as the owner.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

const migrations = join(import.meta.dir, "../../../../db/migrations");
const file = readFileSync(join(migrations, "20261118130001_push_devices.sql"), "utf8");
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f118_s02_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f118_s02_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

async function session(trx: Trx, userId: string, expiresAt = new Date(Date.now() + HOUR_MS)): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at)
    values (${userId}::uuid, ${randomUUID()}, ${expiresAt}) returning id`.execute(trx);
  return rows[0]?.id ?? "";
}

// One device row. The secret is a made-up value: the schema only keeps it.
async function device(
  trx: Trx,
  o: { orgId: string; userId: string },
  over: Partial<{
    org_id: string;
    user_id: string;
    session_id: string | null;
    secret: string;
    key_version: number;
    endpoint_hash: string;
    device_label: string;
    last_error_code: string | null;
  }> = {}
): Promise<string> {
  const row = await trx
    .insertInto("push_subscriptions")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      session_id: null,
      secret: "ciphertext",
      key_version: 1,
      endpoint_hash: hashOf(randomUUID()),
      device_label: "Phone",
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One outbox row of kind `sync_ok` (it needs a mailbox) on the given channel, optionally tied to a device.
async function outboxRow(
  trx: Trx,
  o: Org,
  over: Partial<{
    org_id: string;
    channel: string;
    push_subscription_id: string | null;
    status: string;
    user_id: string;
  }> = {}
): Promise<string> {
  const status = over.status ?? "pending";
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      kind: "sync_ok",
      dedup_key: randomUUID(),
      mailbox_id: o.mailboxId,
      status,
      sent_at: status === "sent" ? new Date() : null,
      error_code: status === "failed" ? "no_device" : null,
      next_attempt_at: new Date(),
      created_at: new Date(),
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("push_subscriptions: constraints", () => {
  test("1: the defaults make a live-looking row with no success and no error; the checks refuse a bad hash, label, version and code", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await device(trx, o);
      const row = await trx.selectFrom("push_subscriptions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ last_success_at: null, last_error_code: null, session_id: null, key_version: 1 });
      expect(row.created_at).toBeInstanceOf(Date);

      for (const endpoint_hash of [
        "",
        "abc",
        hashOf("x").toUpperCase(),
        `${hashOf("x")}0`,
        "https://fcm.googleapis.com/x",
      ])
        await expectSqlState(trx, () => device(trx, o, { endpoint_hash }), CHECK);
      await expectSqlState(trx, () => device(trx, o, { device_label: "x".repeat(61) }), CHECK);
      await device(trx, o, { device_label: "x".repeat(60) });
      await device(trx, o, { device_label: "" });
      await expectSqlState(trx, () => device(trx, o, { key_version: 0 }), CHECK);
      await expectSqlState(trx, () => device(trx, o, { secret: "" }), CHECK);
      // The secret holds the box of one endpoint and its keys: the upper limit is 8192 characters, no more.
      await device(trx, o, { secret: "x".repeat(8192) });
      await expectSqlState(trx, () => device(trx, o, { secret: "x".repeat(8193) }), CHECK);
      for (const code of ["", "HTTP_410", "http 410", "https://x.test", "x".repeat(41)])
        await expectSqlState(trx, () => device(trx, o, { last_error_code: code }), CHECK);
      await device(trx, o, { last_error_code: "push_refused" });
    });
  });

  test("2: one device per user and endpoint; another user, and another endpoint of the same user, may repeat", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const other = await addMember(trx, o.orgId);
      const endpoint_hash = hashOf("same-endpoint");
      await device(trx, o, { endpoint_hash });
      await expectSqlState(trx, () => device(trx, o, { endpoint_hash }), UNIQUE);
      await device(trx, o);
      await device(trx, { orgId: o.orgId, userId: other }, { endpoint_hash });
    });
  });

  test("3: the device belongs to a member of its organization; a removed member takes the devices of that organization only", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      // A stranger in A's organization and an unknown user are no members.
      await expectSqlState(trx, () => device(trx, { orgId: b.orgId, userId: a.userId }), FOREIGN_KEY);
      await expectSqlState(trx, () => device(trx, { orgId: a.orgId, userId: randomUUID() }), FOREIGN_KEY);
      // The same user is a member of both organizations and has a device in each.
      await insertMembership(trx, { orgId: b.orgId }, { userId: a.userId, role: "assistant" });
      const inA = await device(trx, a);
      const inB = await device(trx, { orgId: b.orgId, userId: a.userId });
      await trx.deleteFrom("memberships").where("org_id", "=", a.orgId).where("user_id", "=", a.userId).execute();
      const left = await trx.selectFrom("push_subscriptions").select("id").where("user_id", "=", a.userId).execute();
      expect(left.map((row) => row.id)).toEqual([inB]);
      expect(inA).not.toBe(inB);
    });
  });

  test("4: the session goes: the device stays with a null session; its pending and sent push rows stay", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const sessionId = await session(trx, o.userId);
      const id = await device(trx, o, { session_id: sessionId });
      const pending = await outboxRow(trx, o, { channel: "push", push_subscription_id: id });
      const sent = await outboxRow(trx, o, { channel: "push", push_subscription_id: id, status: "sent" });
      await sql`delete from auth_sessions where id = ${sessionId}::uuid`.execute(trx);
      const row = await trx
        .selectFrom("push_subscriptions")
        .select("session_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.session_id).toBeNull();
      const rows = await trx
        .selectFrom("outbox")
        .select(["id", "status", "push_subscription_id"])
        .where("id", "in", [pending, sent])
        .orderBy("status")
        .execute();
      expect(rows.map((r) => [r.id, r.status, r.push_subscription_id])).toEqual([
        [pending, "pending", id],
        [sent, "sent", id],
      ]);
    });
  });

  test("5: the user goes: the user's devices, memberships and push rows go with them; another user's stay", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const memberId = await addMember(trx, o.orgId);
      const mine = await device(trx, o);
      const theirs = await device(trx, { orgId: o.orgId, userId: memberId });
      await outboxRow(trx, o, { channel: "push", push_subscription_id: mine });
      const theirRow = await outboxRow(
        trx,
        { ...o, userId: memberId },
        { channel: "push", push_subscription_id: theirs }
      );
      await trx.deleteFrom("users").where("id", "=", o.userId).execute();
      const devices = await trx.selectFrom("push_subscriptions").select("id").where("org_id", "=", o.orgId).execute();
      expect(devices.map((row) => row.id)).toEqual([theirs]);
      const rows = await trx.selectFrom("outbox").select("id").where("org_id", "=", o.orgId).execute();
      expect(rows.map((row) => row.id)).toEqual([theirRow]);
    });
  });
});

describe("outbox: the push channel and the device column", () => {
  test("6: only a push row may name a device; a telegram or mail row with a device is refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await device(trx, o);
      await expectSqlState(trx, () => outboxRow(trx, o, { push_subscription_id: id }), CHECK);
      await expectSqlState(trx, () => outboxRow(trx, o, { channel: "mail", push_subscription_id: id }), CHECK);
      await outboxRow(trx, o, { channel: "push", push_subscription_id: id });
      // A push row of a device that is gone keeps no device; a push row may also have none at all.
      await outboxRow(trx, o, { channel: "push", push_subscription_id: null });
      await outboxRow(trx, o, { channel: "telegram" });
      await outboxRow(trx, o, { channel: "mail" });
      await expectSqlState(trx, () => outboxRow(trx, o, { channel: "sms" }), CHECK);
    });
  });

  test("7: the device of a push row must be a device of the same organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const inB = await device(trx, b);
      await expectSqlState(trx, () => outboxRow(trx, a, { channel: "push", push_subscription_id: inB }), FOREIGN_KEY);
      await expectSqlState(
        trx,
        () => outboxRow(trx, a, { channel: "push", push_subscription_id: randomUUID() }),
        FOREIGN_KEY
      );
    });
  });

  test("8: the device goes: the push rows stay as history, with a null device and their status", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await device(trx, o);
      const pending = await outboxRow(trx, o, { channel: "push", push_subscription_id: id });
      const sent = await outboxRow(trx, o, { channel: "push", push_subscription_id: id, status: "sent" });
      await trx.deleteFrom("push_subscriptions").where("id", "=", id).execute();
      const rows = await trx
        .selectFrom("outbox")
        .select(["id", "status", "push_subscription_id", "org_id"])
        .where("id", "in", [pending, sent])
        .orderBy("status")
        .execute();
      expect(rows.map((r) => [r.id, r.status, r.push_subscription_id, r.org_id])).toEqual([
        [pending, "pending", null, o.orgId],
        [sent, "sent", null, o.orgId],
      ]);
    });
  });

  test("9: the table and the column have exactly the planned indexes", async () => {
    const { rows } = await sql<{ indexname: string }>`
      select indexname from pg_indexes
      where tablename in ('push_subscriptions', 'outbox') and indexname like '%push%' order by indexname`.execute(db);
    expect(rows.map((row) => row.indexname)).toEqual([
      "outbox_push_subscription_idx",
      "push_subscriptions_id_org_id_key",
      "push_subscriptions_member_idx",
      "push_subscriptions_pkey",
      "push_subscriptions_session_idx",
      "push_subscriptions_user_id_endpoint_hash_key",
    ]);
  });
});

describe("memberships.notice_routes", () => {
  test("10: the default is an empty object; an object passes; an array, a string, a number and null do not", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const read = async () =>
        (
          await trx
            .selectFrom("memberships")
            .select("notice_routes")
            .where("org_id", "=", o.orgId)
            .where("user_id", "=", o.userId)
            .executeTakeFirstOrThrow()
        ).notice_routes;
      expect(await read()).toEqual({});
      const set = (value: string) =>
        sql`update memberships set notice_routes = ${value}::jsonb where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
          trx
        );
      for (const bad of ["[]", '"both"', "1", "true", "null"]) await expectSqlState(trx, () => set(bad), CHECK);
      await expectSqlState(
        trx,
        () =>
          sql`update memberships set notice_routes = null where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
            trx
          ),
        "23502"
      );
      await set('{"urgent":"both","approvals":"push"}');
      expect(await read()).toEqual({ urgent: "both", approvals: "push" });
    });
  });

  test("10b: only the keys urgent, approvals and updates with the values telegram, push and both fit; no free text fits", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const set = (value: string) =>
        sql`update memberships set notice_routes = ${value}::jsonb where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
          trx
        );
      const read = async () =>
        (
          await trx
            .selectFrom("memberships")
            .select("notice_routes")
            .where("org_id", "=", o.orgId)
            .where("user_id", "=", o.userId)
            .executeTakeFirstOrThrow()
        ).notice_routes;
      for (const group of ["urgent", "approvals", "updates"])
        for (const route of ["telegram", "push", "both"]) {
          const value = { [group]: route };
          await set(JSON.stringify(value));
          expect(await read()).toEqual(value);
        }
      await set('{"urgent":"telegram","approvals":"push","updates":"both"}');
      await set("{}");
      const bad = [
        // an unknown key, also next to good ones, also a near name and a different case
        '{"fax":"push"}',
        '{"urgent":"push","fax":"push"}',
        '{"Urgent":"push"}',
        '{"urgent ":"push"}',
        '{"":"push"}',
        // an unknown value, a different case, a space, an empty string, free text
        '{"urgent":"fax"}',
        '{"urgent":"PUSH"}',
        '{"urgent":"push "}',
        '{"urgent":""}',
        '{"urgent":"call me at jan@x.test"}',
        // a value that is not a string
        '{"urgent":1}',
        '{"urgent":true}',
        '{"urgent":null}',
        '{"urgent":["push"]}',
        '{"urgent":{"a":"push"}}',
        // one bad value next to good ones
        '{"urgent":"push","approvals":"fax"}',
      ];
      for (const value of bad) await expectSqlState(trx, () => set(value), CHECK);
      expect(await read()).toEqual({});
    });
  });

  test("10c: a value of 100 kB (a long key, a long text value, many keys) is refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const set = (value: string) =>
        sql`update memberships set notice_routes = ${value}::jsonb where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
          trx
        );
      const big = "x".repeat(100_000);
      const many = Object.fromEntries(Array.from({ length: 5000 }, (_, n) => [`k${n}`, "push"]));
      for (const value of [{ [big]: "push" }, { urgent: big }, many])
        await expectSqlState(trx, () => set(JSON.stringify(value)), CHECK);
      const row = await trx
        .selectFrom("memberships")
        .select("notice_routes")
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .executeTakeFirstOrThrow();
      expect(row.notice_routes).toEqual({});
    });
  });
});

describe("push_subscriptions: row-level security", () => {
  test("11: under the scope of organization B, A's devices are not visible, none can be written for A, none can change", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await device(trx, a);
      await device(trx, b);
      await scopeLocal(trx, b.orgId);
      const rows = await trx.selectFrom("push_subscriptions").select("org_id").execute();
      expect(rows.map((row) => row.org_id)).toEqual([b.orgId]);
      // No RETURNING: it would also need the SELECT side of the policy, and hide a missing WITH CHECK.
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("push_subscriptions")
            .values({
              org_id: a.orgId,
              user_id: a.userId,
              secret: "ciphertext",
              key_version: 1,
              endpoint_hash: hashOf(randomUUID()),
              device_label: "Phone",
            })
            .execute(),
        RLS
      );
      // A row of B cannot be moved into A (the WITH CHECK of the update).
      await expectSqlState(
        trx,
        () => trx.updateTable("push_subscriptions").set({ org_id: a.orgId }).where("org_id", "=", b.orgId).execute(),
        RLS
      );
      const changed = await trx
        .updateTable("push_subscriptions")
        .set({ device_label: "Changed" })
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(changed.numUpdatedRows).toBe(0n);
      const deleted = await trx.deleteFrom("push_subscriptions").where("org_id", "=", a.orgId).executeTakeFirst();
      expect(deleted.numDeletedRows).toBe(0n);
    });
  });

  test("12: the table has row-level security on, the one tenant policy, and the app role may use it", async () => {
    const policy = await sql<{ policyname: string; roles: string[]; qual: string; with_check: string }>`
      select policyname, roles::text[] as roles, qual, with_check from pg_policies where tablename = 'push_subscriptions'`.execute(
      db
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]).toMatchObject({
      policyname: "tenant_rows",
      roles: ["app"],
      qual: "((app_current_org() IS NULL) OR (org_id = app_current_org()))",
      with_check: "((app_current_org() IS NULL) OR (org_id = app_current_org()))",
    });
    const flags = await sql<{ rls: boolean; privs: string }>`
      select c.relrowsecurity as rls,
        (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
          where has_table_privilege('app', c.oid, p)) as privs
      from pg_class c where c.relname = 'push_subscriptions'`.execute(db);
    expect(flags.rows[0]).toEqual({ rls: true, privs: "DELETE,INSERT,SELECT,UPDATE" });
  });
});

describe("the previous release", () => {
  test("13: its statements (no push column, no notice_routes) still work and leave the new values at their defaults", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      // The INSERT of the code before the phone channel names no `push_subscription_id`; its rows are `telegram` or `mail`.
      await sql`
        INSERT INTO outbox (org_id, user_id, kind, dedup_key, mailbox_id, status, next_attempt_at, created_at, channel)
        VALUES (${o.orgId}, ${o.userId}, 'sync_ok', ${randomUUID()}, ${o.mailboxId}, 'pending', now(), now(), 'telegram')`.execute(
        trx
      );
      const row = await trx
        .selectFrom("outbox")
        .select("push_subscription_id")
        .where("org_id", "=", o.orgId)
        .executeTakeFirstOrThrow();
      expect(row.push_subscription_id).toBeNull();
      // The INSERT of a membership by the old code names no `notice_routes` (`addMember` writes none): the default is `{}`.
      const memberId = await addMember(trx, o.orgId);
      const member = await trx
        .selectFrom("memberships")
        .select("notice_routes")
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", memberId)
        .executeTakeFirstOrThrow();
      expect(member.notice_routes).toEqual({});
      const columns = await sql<{ column_name: string; is_nullable: string; column_default: string | null }>`
        select column_name, is_nullable, column_default from information_schema.columns
        where (table_name = 'outbox' and column_name = 'push_subscription_id')
          or (table_name = 'memberships' and column_name = 'notice_routes') order by column_name`.execute(trx);
      expect(columns.rows).toEqual([
        { column_name: "notice_routes", is_nullable: "NO", column_default: "'{}'::jsonb" },
        { column_name: "push_subscription_id", is_nullable: "YES", column_default: null },
      ]);
    });
  });
});

describe("the Down and Up sections", () => {
  async function withOwner(run: (trx: Trx) => Promise<void>): Promise<void> {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      await withRollback(owner, run);
    } finally {
      await owner.destroy();
    }
  }

  const present = async (trx: Trx) => {
    const { rows } = await sql<{ tables: number; push_column: number; routes_column: number; push_channel: boolean }>`
      select
        (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'push_subscriptions') as tables,
        (select count(*)::int from information_schema.columns
          where table_name = 'outbox' and column_name = 'push_subscription_id') as push_column,
        (select count(*)::int from information_schema.columns
          where table_name = 'memberships' and column_name = 'notice_routes') as routes_column,
        (select pg_get_constraintdef(oid) like '%push%' from pg_constraint where conname = 'outbox_channel_check') as push_channel`.execute(
      trx
    );
    return rows[0];
  };

  test("14: Down drops the table, the column and the push rows and keeps the other rows; Up makes them again", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await device(trx, o, { session_id: await session(trx, o.userId) });
      const pushRow = await outboxRow(trx, o, { channel: "push", push_subscription_id: id });
      const telegramRow = await outboxRow(trx, o);
      await sql`update memberships set notice_routes = '{"urgent":"push"}'::jsonb
        where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(trx);
      expect(await present(trx)).toEqual({ tables: 1, push_column: 1, routes_column: 1, push_channel: true });

      await sql.raw(downPart).execute(trx);
      expect(await present(trx)).toEqual({ tables: 0, push_column: 0, routes_column: 0, push_channel: false });
      const kept = await trx.selectFrom("outbox").select("id").where("id", "in", [pushRow, telegramRow]).execute();
      expect(kept.map((row) => row.id)).toEqual([telegramRow]);
      // The old list refuses the channel again.
      await expectSqlState(
        trx,
        () => sql`update outbox set channel = 'push' where id = ${telegramRow}::uuid`.execute(trx),
        CHECK
      );

      await sql.raw(up).execute(trx);
      expect(await present(trx)).toEqual({ tables: 1, push_column: 1, routes_column: 1, push_channel: true });
      const routes = await trx
        .selectFrom("memberships")
        .select("notice_routes")
        .where("org_id", "=", o.orgId)
        .where("user_id", "=", o.userId)
        .executeTakeFirstOrThrow();
      expect(routes.notice_routes).toEqual({});
      const again = await device(trx, o);
      await outboxRow(trx, o, { channel: "push", push_subscription_id: again });
    });
  });
});

describe("the migration file", () => {
  test("15: the file holds no drop or narrowing in its Up part; the contract line silences only the two constraints on the new column", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    const withoutMark = file.replace(/^-- contract: v\d+\.\d+\.\d+$/m, "-- (mark removed)");
    expect(withoutMark).not.toBe(file);
    // Without the mark the check reads exactly the foreign key and the CHECK on `outbox.push_subscription_id`.
    expect(checkMigrationSql(withoutMark).map((finding) => finding.rule)).toEqual(["add_constraint", "add_constraint"]);
    const statements = upPart
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/(?<!ON\s)\b(DELETE|UPDATE|INSERT|TRUNCATE)\b/);
  });
});
