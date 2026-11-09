import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createOrganizationWithOwner, getOrganization, listMemberships } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const orgCreateScript = resolve(import.meta.dir, "../../src/scripts/org-create.ts");

afterAll(async () => {
  await db.destroy();
});

async function createTwoOrgs(trx: Transaction<DB>) {
  const a = await createOrganizationWithOwner(trx, {
    orgName: "Org A",
    timezone: "Europe/Warsaw",
    email: "a@x.test",
    displayName: "Owner A",
  });
  const b = await createOrganizationWithOwner(trx, {
    orgName: "Org B",
    timezone: "Europe/Warsaw",
    email: "b@x.test",
    displayName: "Owner B",
  });
  return { a, b };
}

async function countRows(trx: Transaction<DB>) {
  const orgs = await trx
    .selectFrom("organizations")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  const users = await trx
    .selectFrom("users")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return { orgs: Number(orgs.n), users: Number(users.n) };
}

describe("tenancy repository filters by org_id", () => {
  test("listMemberships returns only the members of the caller's organization", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoOrgs(trx);
      const members = await listMemberships(trx, { orgId: a.orgId });
      expect(members).toHaveLength(1);
      expect(members[0]?.email).toBe("a@x.test");
      expect(members[0]?.role).toBe("owner");
      expect(members[0]?.org_id).toBe(a.orgId);
      expect(members[0]?.user_id).toBe(a.userId);
    });
  });

  test("getOrganization returns only the caller's organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoOrgs(trx);
      const orgB = await getOrganization(trx, { orgId: b.orgId });
      expect(orgB?.id).toBe(b.orgId);
      expect(orgB?.name).toBe("Org B");
      const orgA = await getOrganization(trx, { orgId: a.orgId });
      expect(orgA?.id).toBe(a.orgId);
      expect(orgA?.id).not.toBe(b.orgId);
      expect(await getOrganization(trx, { orgId: randomUUID() })).toBeUndefined();
    });
  });

  test("insertMembership writes the org_id of the context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoOrgs(trx);
      const c = await insertUser(trx, { email: "c@x.test", displayName: "Assistant C" });
      await insertMembership(trx, { orgId: b.orgId }, { userId: c.id, role: "assistant" });
      const membersA = await listMemberships(trx, { orgId: a.orgId });
      expect(membersA.map((m) => m.email)).toEqual(["a@x.test"]);
      const membersB = await listMemberships(trx, { orgId: b.orgId });
      expect(membersB.map((m) => [m.email, m.role])).toEqual([
        ["b@x.test", "owner"],
        ["c@x.test", "assistant"],
      ]);
    });
  });
});

describe("createOrganizationWithOwner", () => {
  test("a duplicate e-mail rejects and leaves no new organization", async () => {
    await withRollback(db, async (trx) => {
      await createTwoOrgs(trx);
      await sql`savepoint duplicate_email`.execute(trx);
      await expect(
        createOrganizationWithOwner(trx, {
          orgName: "Org C",
          timezone: "Europe/Warsaw",
          email: "a@x.test",
          displayName: "Owner C",
        })
      ).rejects.toMatchObject({ code: "23505" });
      await sql`rollback to savepoint duplicate_email`.execute(trx);
      const orgsC = await trx.selectFrom("organizations").select("id").where("name", "=", "Org C").execute();
      expect(orgsC).toHaveLength(0);
    });
  });

  test("an invalid timezone rejects before a write", async () => {
    await withRollback(db, async (trx) => {
      const before = await countRows(trx);
      await expect(
        createOrganizationWithOwner(trx, {
          orgName: "Org D",
          timezone: "Mars/Base",
          email: "d@x.test",
          displayName: "Owner D",
        })
      ).rejects.toThrow("timezone");
      // A failed write would abort the transaction; this query would then fail.
      expect(await countRows(trx)).toEqual(before);
    });
  });
});

describe("org:create CLI", () => {
  function runOrgCreate(args: string[]) {
    return Bun.spawn(["bun", orgCreateScript, ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  }

  test("creates the organization, user and owner membership; a duplicate e-mail leaves no organization", async () => {
    const suffix = randomUUID();
    const email = `org-create-${suffix}@x.test`;
    const orgName = `Test Org ${suffix}`;
    const duplicateOrgName = `Test Org duplicate ${suffix}`;
    try {
      const first = runOrgCreate(["--org-name", orgName, "--email", email, "--display-name", "T"]);
      expect(await first.exited).toBe(0);
      const stdout = await new Response(first.stdout).text();
      const match = /\[org-create\] created org (\S+) user (\S+)/.exec(stdout);
      expect(match).not.toBeNull();
      const orgId = match?.[1] ?? "";
      const userId = match?.[2] ?? "";
      const members = await listMemberships(db, { orgId });
      expect(members.map((m) => [m.user_id, m.email, m.role])).toEqual([[userId, email, "owner"]]);
      expect(stdout).not.toContain(email);

      const duplicate = runOrgCreate(["--org-name", duplicateOrgName, "--email", email, "--display-name", "T"]);
      expect(await duplicate.exited).toBe(1);
      expect(await new Response(duplicate.stderr).text()).toContain("user with this email already exists");
      const orphans = await db.selectFrom("organizations").select("id").where("name", "=", duplicateOrgName).execute();
      expect(orphans).toHaveLength(0);
    } finally {
      await db.deleteFrom("organizations").where("name", "in", [orgName, duplicateOrgName]).execute();
      await db
        .deleteFrom("users")
        .where((eb) => eb(eb.fn("lower", ["email"]), "=", email.toLowerCase()))
        .execute();
    }
  });

  test("a missing option prints the usage and exits 1", async () => {
    const proc = runOrgCreate(["--org-name", "No Email"]);
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage");
  });
});
