import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

// The migration `sso.sql`. `sso_providers`, `organizations.sso_required`, `auth_sessions.sign_in_method`,
// `auth_sessions.sso_started_at` and the cap trigger `auth_sessions_sso_cap`. The connection is the `app` role.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const UNIQUE = "23505";
const CHECK = "23514";
const RLS = "42501";

interface Org {
  orgId: string;
  userId: string;
}

async function seedOrg(trx: Trx): Promise<Org> {
  const id = randomUUID();
  return createOrganizationWithOwner(trx, {
    orgName: `Org ${id}`,
    timezone: "Europe/Warsaw",
    email: `owner-${id}@x.test`,
    displayName: "Owner",
    locale: "en",
  });
}

// A domain that no committed row of another test file can own.
const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;

interface ProviderFields {
  issuer?: string;
  domain?: string;
  domain_verified?: boolean;
  domain_proof?: string | null;
  saml_config?: string | null;
  user_id?: string | null;
}

async function insertProvider(trx: Trx, orgId: string, fields: ProviderFields = {}): Promise<void> {
  const issuer = fields.issuer ?? "https://idp.x.test";
  const domain = fields.domain ?? freshDomain();
  const verified = fields.domain_verified ?? false;
  const proof = fields.domain_proof ?? null;
  const saml = fields.saml_config ?? null;
  const userId = fields.user_id ?? null;
  await sql`insert into sso_providers (provider_id, org_id, issuer, domain, domain_verified, domain_proof, oidc_config, saml_config, user_id)
    values (${orgId}, ${orgId}::uuid, ${issuer}, ${domain}, ${verified}, ${proof}, '{"clientSecret":"s"}', ${saml}, ${userId}::uuid)`.execute(
    trx
  );
}

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f119_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f119_case`.execute(trx);
}

async function insertSession(
  trx: Trx,
  userId: string,
  fields: { method?: string; startedAgo?: string | null; expiresIn: string }
): Promise<string> {
  const id = randomUUID();
  const method = fields.method ?? "password";
  const started = fields.startedAgo ? sql`now() - ${fields.startedAgo}::interval` : sql`null`;
  await sql`insert into auth_sessions (id, user_id, token, expires_at, sign_in_method, sso_started_at)
    values (${id}::uuid, ${userId}::uuid, ${randomUUID()}, now() + ${fields.expiresIn}::interval, ${method}, ${started})`.execute(
    trx
  );
  return id;
}

interface SessionRow {
  method: string;
  capped: boolean;
  left_s: number;
}

// `capped`: the end is exactly 12 h after the IdP sign-in. `left_s`: seconds from now to the end.
async function readSession(trx: Trx, id: string): Promise<SessionRow> {
  const { rows } = await sql<SessionRow>`
    select sign_in_method as method,
      coalesce(expires_at = sso_started_at + interval '12 hours', false) as capped,
      extract(epoch from expires_at - now())::int as left_s
    from auth_sessions where id = ${id}::uuid`.execute(trx);
  const row = rows[0];
  if (!row) throw new Error("session row missing");
  return row;
}

describe("sso_providers constraints", () => {
  test("1: one provider per organization and one organization per domain", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const domain = freshDomain();
      await insertProvider(trx, A.orgId, { domain });
      await expectSqlState(trx, () => insertProvider(trx, A.orgId), UNIQUE);
      await expectSqlState(trx, () => insertProvider(trx, B.orgId, { domain }), UNIQUE);
      await insertProvider(trx, B.orgId);
    });
  });

  test("2: the domain and the issuer checks", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      for (const domain of ["X.test", "x", "-x.test"]) {
        await expectSqlState(trx, () => insertProvider(trx, A.orgId, { domain }), CHECK);
      }
      const refused = [
        "http://idp.x.test",
        "http://127.0.0.1",
        "http://127.0.0.1:123456",
        "http://127.0.0.1:4000/x",
        "http://localhost:4000",
        "http://10.0.0.1:4000",
        "ftp://idp.x.test",
        "idp.x.test",
      ];
      for (const issuer of refused) {
        await expectSqlState(trx, () => insertProvider(trx, A.orgId, { issuer }), CHECK);
      }
      await insertProvider(trx, A.orgId, { issuer: "http://127.0.0.1:4000" });
    });
  });

  test("2b: an https issuer is accepted", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await insertProvider(trx, A.orgId, { issuer: "https://login.microsoftonline.com/t/v2.0" });
      const rows = await sql<{
        issuer: string;
        domain_verified: boolean;
      }>`select issuer, domain_verified from sso_providers where org_id = ${A.orgId}::uuid`.execute(trx);
      expect(rows.rows).toEqual([{ issuer: "https://login.microsoftonline.com/t/v2.0", domain_verified: false }]);
    });
  });

  test("3: domain_verified and domain_proof go together", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await expectSqlState(trx, () => insertProvider(trx, A.orgId, { domain_verified: true }), CHECK);
      await expectSqlState(trx, () => insertProvider(trx, A.orgId, { domain_proof: "dns" }), CHECK);
      await expectSqlState(
        trx,
        () => insertProvider(trx, A.orgId, { domain_verified: true, domain_proof: "other" }),
        CHECK
      );
      await insertProvider(trx, A.orgId, { domain_verified: true, domain_proof: "attested" });
    });
  });

  test("4: saml_config must stay NULL", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await expectSqlState(trx, () => insertProvider(trx, A.orgId, { saml_config: "{}" }), CHECK);
    });
  });
});

describe("auth_sessions sign-in method and cap", () => {
  test("5: an SSO session insert is capped at sso_started_at + 12 h", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const id = await insertSession(trx, A.userId, { method: "sso", startedAgo: "2 hours", expiresIn: "30 days" });
      expect(await readSession(trx, id)).toMatchObject({ method: "sso", capped: true });
    });
  });

  test("6: an update cannot lift the cap or the method; moving sso_started_at moves the end", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const id = await insertSession(trx, A.userId, { method: "sso", startedAgo: "2 hours", expiresIn: "30 days" });

      await sql`update auth_sessions set expires_at = now() + interval '30 days' where id = ${id}::uuid`.execute(trx);
      expect(await readSession(trx, id)).toMatchObject({ method: "sso", capped: true });

      await sql`update auth_sessions set sign_in_method = 'password' where id = ${id}::uuid`.execute(trx);
      expect(await readSession(trx, id)).toMatchObject({ method: "sso", capped: true });

      await sql`update auth_sessions set sso_started_at = now() - interval '13 hours' where id = ${id}::uuid`.execute(
        trx
      );
      const moved = await readSession(trx, id);
      expect(moved.method).toBe("sso");
      expect(moved.left_s).toBeLessThan(0);
    });
  });

  test("7: a password session keeps a 30 day end on insert and on update", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const id = await insertSession(trx, A.userId, { expiresIn: "30 days" });
      const day = 24 * 3600;
      const inserted = await readSession(trx, id);
      expect(inserted.method).toBe("password");
      expect(inserted.left_s).toBeGreaterThan(29 * day);

      await sql`update auth_sessions set expires_at = now() + interval '31 days' where id = ${id}::uuid`.execute(trx);
      const updated = await readSession(trx, id);
      expect(updated.method).toBe("password");
      expect(updated.left_s).toBeGreaterThan(30 * day);
    });
  });

  test("8: the method is a closed list, and it pairs with sso_started_at", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await expectSqlState(trx, () => insertSession(trx, A.userId, { method: "other", expiresIn: "1 day" }), CHECK);
      await expectSqlState(trx, () => insertSession(trx, A.userId, { method: "sso", expiresIn: "1 day" }), CHECK);
      await expectSqlState(
        trx,
        () => insertSession(trx, A.userId, { method: "password", startedAgo: "1 hour", expiresIn: "1 day" }),
        CHECK
      );
    });
  });

  test("8b: a row without a method is a password session; sso_started_at cannot be cleared on an SSO session", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const plain = randomUUID();
      await sql`insert into auth_sessions (id, user_id, token, expires_at)
        values (${plain}::uuid, ${A.userId}::uuid, ${randomUUID()}, now() + interval '1 day')`.execute(trx);
      expect((await readSession(trx, plain)).method).toBe("password");

      const sso = await insertSession(trx, A.userId, { method: "sso", startedAgo: "1 hour", expiresIn: "1 day" });
      await expectSqlState(
        trx,
        () => sql`update auth_sessions set sso_started_at = null where id = ${sso}::uuid`.execute(trx),
        CHECK
      );
    });
  });
  test("8c: one UPDATE that sets the method and sso_started_at together cannot change the method", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const sso = await insertSession(trx, A.userId, { method: "sso", startedAgo: "1 hour", expiresIn: "1 day" });
      await expectSqlState(
        trx,
        () =>
          sql`update auth_sessions set sign_in_method = 'password', sso_started_at = null
            where id = ${sso}::uuid`.execute(trx),
        CHECK
      );
      expect(await readSession(trx, sso)).toMatchObject({ method: "sso", capped: true });

      const plain = await insertSession(trx, A.userId, { expiresIn: "30 days" });
      await expectSqlState(
        trx,
        () =>
          sql`update auth_sessions set sign_in_method = 'sso', sso_started_at = now() - interval '1 hour'
            where id = ${plain}::uuid`.execute(trx),
        CHECK
      );
      const row = await readSession(trx, plain);
      expect(row.method).toBe("password");
      expect(row.capped).toBe(false);
      expect(row.left_s).toBeGreaterThan(29 * 24 * 3600);
    });
  });
});

describe("sso_providers row level security", () => {
  test("9: under the scope of B the app role sees no provider of A or C and cannot write for them", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const C = await seedOrg(trx);
      for (const org of [A, B, C]) await insertProvider(trx, org.orgId);

      // No scope: every provider is visible, and the plugin's lock UPDATE passes (spike.md, finding on the plugin lock).
      const open = await sql<{ n: number }>`select count(*)::int as n from sso_providers
        where org_id in (${A.orgId}::uuid, ${B.orgId}::uuid, ${C.orgId}::uuid)`.execute(trx);
      expect(open.rows[0]?.n).toBe(3);
      const lock = await sql`update sso_providers set provider_id = provider_id`.execute(trx);
      expect(Number(lock.numAffectedRows)).toBeGreaterThanOrEqual(3);

      await sql`select set_config('app.org_id', ${B.orgId}, true)`.execute(trx);
      const seen = await sql<{ org_id: string }>`select org_id from sso_providers
        where org_id in (${A.orgId}::uuid, ${B.orgId}::uuid, ${C.orgId}::uuid)`.execute(trx);
      expect(seen.rows.map((row) => row.org_id)).toEqual([B.orgId]);

      // An update or a delete of the row of A or C finds nothing.
      const updated = await sql`update sso_providers set issuer = 'https://evil.x.test'
        where org_id in (${A.orgId}::uuid, ${C.orgId}::uuid)`.execute(trx);
      expect(Number(updated.numAffectedRows)).toBe(0);
      const deleted = await sql`delete from sso_providers where org_id in (${A.orgId}::uuid, ${C.orgId}::uuid)`.execute(
        trx
      );
      expect(Number(deleted.numAffectedRows)).toBe(0);

      // An insert for A or C is refused by the WITH CHECK. B's row goes first, so the unique key on org_id stays free.
      await sql`delete from sso_providers where org_id = ${B.orgId}::uuid`.execute(trx);
      await expectSqlState(trx, () => insertProvider(trx, A.orgId), RLS);
      await expectSqlState(trx, () => insertProvider(trx, C.orgId), RLS);
      await insertProvider(trx, B.orgId);

      await sql`select set_config('app.org_id', '', true)`.execute(trx);
      const kept = await sql<{ org_id: string; issuer: string }>`select org_id, issuer from sso_providers
        where org_id in (${A.orgId}::uuid, ${B.orgId}::uuid, ${C.orgId}::uuid)`.execute(trx);
      expect(kept.rows.map((row) => row.issuer)).toEqual([
        "https://idp.x.test",
        "https://idp.x.test",
        "https://idp.x.test",
      ]);
    });
  });

  test("9b: with no scope the app role runs UPDATE sso_providers (the lock of the plugin)", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      await insertProvider(trx, A.orgId);
      const result = await sql`update sso_providers set provider_id = provider_id
        where org_id = ${A.orgId}::uuid`.execute(trx);
      expect(Number(result.numAffectedRows)).toBe(1);
    });
  });

  test("9c: the app role has exactly SELECT, INSERT, UPDATE, DELETE on sso_providers", async () => {
    const { rows } = await sql<{ privilege_type: string }>`
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'sso_providers' and grantee = 'app'
      order by 1`.execute(db);
    expect(rows.map((row) => row.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });
});

describe("sso_providers references", () => {
  test("10: deleting the organization removes its provider; deleting the user clears user_id", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const B = await seedOrg(trx);
      const C = await seedOrg(trx);
      await insertProvider(trx, A.orgId);
      await insertProvider(trx, B.orgId, { user_id: C.userId });
      await insertProvider(trx, C.orgId);

      await sql`select delete_organization(${A.orgId}::uuid)`.execute(trx);
      const afterA = await sql<{ org_id: string }>`select org_id from sso_providers
        where org_id in (${A.orgId}::uuid, ${B.orgId}::uuid, ${C.orgId}::uuid)`.execute(trx);
      expect(afterA.rows.map((row) => row.org_id).sort()).toEqual([B.orgId, C.orgId].sort());

      await sql`delete from memberships where user_id = ${C.userId}::uuid`.execute(trx);
      await sql`delete from users where id = ${C.userId}::uuid`.execute(trx);
      const afterUser = await sql<{ user_id: string | null }>`select user_id from sso_providers
        where org_id = ${B.orgId}::uuid`.execute(trx);
      expect(afterUser.rows).toEqual([{ user_id: null }]);
    });
  });
});

describe("organizations.sso_required", () => {
  test("11: the flag defaults to false", async () => {
    await withRollback(db, async (trx) => {
      const A = await seedOrg(trx);
      const { rows } = await sql<{ sso_required: boolean }>`
        select sso_required from organizations where id = ${A.orgId}::uuid`.execute(trx);
      expect(rows).toEqual([{ sso_required: false }]);
    });
  });
});
