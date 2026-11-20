import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner, setBreakGlassOwner } from "../../src/modules/tenancy";

import { testDb } from "./helpers";

// The confirm guard of the danger tools that had none (docs/cli.md § Risk classes): `org:break-glass` set and `--clear`,
// and `web:two-factor-reset`, spawned as the operator runs them. `org:delete` and `org:dsr --erase` keep their own
// confirm tests (`org-delete-cli.test.ts`, `privacy-dsr-erase-cli.test.ts`).
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const scripts = resolve(import.meta.dir, "../../src/scripts");
const breakGlass = resolve(scripts, "org-break-glass.ts");
const twoFactorReset = resolve(scripts, "web-two-factor-reset.ts");

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function run(script: string, args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

// Committed rows, so the spawned script sees them. An owner with the second factor on also has a session row.
async function createOwner(options: { twoFactor: boolean; breakGlass: boolean }) {
  const orgName = `Danger Org ${randomUUID()}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName,
    timezone: "Europe/Warsaw",
    email: `danger-${randomUUID()}@x.test`,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  if (options.twoFactor) {
    await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${userId}`.execute(db);
    await sql`INSERT INTO auth_two_factors (user_id, secret, backup_codes, verified) VALUES (${userId}, 'x', 'x', true)`.execute(
      db
    );
    await sql`INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (${userId}, ${randomUUID()}, now() + interval '1 day')`.execute(
      db
    );
  }
  if (options.breakGlass) await setBreakGlassOwner(db, { orgId }, { userId, actor: "cli", now: new Date() });
  return { orgId, userId, orgName };
}

async function auditCount(orgId: string, event: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*) AS n FROM audit_log WHERE org_id = ${orgId} AND event = ${event}`.execute(db);
  return Number(result.rows[0]?.n);
}

const markOf = async (orgId: string, userId: string): Promise<boolean | undefined> =>
  (
    await db
      .selectFrom("memberships")
      .select("break_glass")
      .where("org_id", "=", orgId)
      .where("user_id", "=", userId)
      .executeTakeFirst()
  )?.break_glass;

const twoFactorRows = async (userId: string): Promise<number> =>
  Number(
    (await sql<{ n: string }>`SELECT count(*) AS n FROM auth_two_factors WHERE user_id = ${userId}`.execute(db)).rows[0]
      ?.n
  );

describe("org:break-glass confirm", () => {
  test("1. set without --confirm: exit 2, the usage, nothing changes, no audit row", async () => {
    const { orgId, userId } = await createOwner({ twoFactor: true, breakGlass: false });
    const result = await run(breakGlass, ["--org-id", orgId, "--user-id", userId]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: bun run org:break-glass");
    expect(await markOf(orgId, userId)).toBe(false);
    expect(await auditCount(orgId, "org.break_glass_set")).toBe(0);
  });

  test("2. set with the wrong name: exit 1, refused, nothing changes, no audit row", async () => {
    const { orgId, userId, orgName } = await createOwner({ twoFactor: true, breakGlass: false });
    const result = await run(breakGlass, ["--org-id", orgId, "--user-id", userId, "--confirm", "Wrong Name"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refused: confirm does not match");
    expect(result.stdout + result.stderr).not.toContain(orgName);
    expect(await markOf(orgId, userId)).toBe(false);
    expect(await auditCount(orgId, "org.break_glass_set")).toBe(0);
  });

  test("3. set with the name in capitals and spaces around it: exit 0, the mark is set, one audit row", async () => {
    const { orgId, userId, orgName } = await createOwner({ twoFactor: true, breakGlass: false });
    const result = await run(breakGlass, [
      "--org-id",
      orgId,
      "--user-id",
      userId,
      "--confirm",
      `  ${orgName.toUpperCase()}  `,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`org ${orgId}: break-glass owner ${userId}`);
    expect(result.stdout + result.stderr).not.toContain(orgName);
    expect(await markOf(orgId, userId)).toBe(true);
    expect(await auditCount(orgId, "org.break_glass_set")).toBe(1);
  });

  test("4. --clear without --confirm: exit 2 and the mark stays; with the right name: exit 0 and the mark is gone", async () => {
    const { orgId, userId, orgName } = await createOwner({ twoFactor: true, breakGlass: true });
    const missing = await run(breakGlass, ["--org-id", orgId, "--clear"]);
    expect(missing.code).toBe(2);
    expect(await markOf(orgId, userId)).toBe(true);
    const wrong = await run(breakGlass, ["--org-id", orgId, "--clear", "--confirm", "Wrong Name"]);
    expect(wrong.code).toBe(1);
    expect(await markOf(orgId, userId)).toBe(true);
    const cleared = await run(breakGlass, ["--org-id", orgId, "--clear", "--confirm", orgName]);
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain(`break-glass owner ${userId} cleared`);
    expect(await markOf(orgId, userId)).toBe(false);
  });

  test("5. the list mode needs no confirm and changes no row; a confirm with it is a usage error", async () => {
    const { orgId, userId } = await createOwner({ twoFactor: true, breakGlass: true });
    const result = await run(breakGlass, ["--org-id", orgId]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`owner ${userId}: two-factor on, break-glass yes`);
    expect(await markOf(orgId, userId)).toBe(true);
    expect(await auditCount(orgId, "org.break_glass_cleared")).toBe(0);
    expect((await run(breakGlass, ["--org-id", orgId, "--confirm", "x"])).code).toBe(2);
  });

  test("9a. a refusal of the service stays with the right name: no second factor, and not an owner", async () => {
    const owner = await createOwner({ twoFactor: false, breakGlass: false });
    const noFactor = await run(breakGlass, [
      "--org-id",
      owner.orgId,
      "--user-id",
      owner.userId,
      "--confirm",
      owner.orgName,
    ]);
    expect(noFactor.code).toBe(1);
    expect(noFactor.stderr).toContain("user has no two-factor sign-in");

    const other = await createOwner({ twoFactor: true, breakGlass: false });
    const notOwner = await run(breakGlass, [
      "--org-id",
      owner.orgId,
      "--user-id",
      other.userId,
      "--confirm",
      owner.orgName,
    ]);
    expect(notOwner.code).toBe(1);
    expect(notOwner.stderr).toContain("user is not an owner of this organization");
    expect(await markOf(owner.orgId, owner.userId)).toBe(false);
    expect(await auditCount(owner.orgId, "org.break_glass_set")).toBe(0);
  });
});

describe("web:two-factor-reset confirm", () => {
  test("6. no --confirm: exit 2; the wrong name: exit 1; both leave the rows and write no audit row; the right name: exit 0", async () => {
    const { orgId, userId, orgName } = await createOwner({ twoFactor: true, breakGlass: false });
    const missing = await run(twoFactorReset, ["--org-id", orgId, "--user-id", userId]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("usage: bun run web:two-factor-reset");
    const wrong = await run(twoFactorReset, ["--org-id", orgId, "--user-id", userId, "--confirm", "Wrong Name"]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain("refused: confirm does not match");
    expect(await twoFactorRows(userId)).toBe(1);
    expect(await auditCount(orgId, "web.two_factor_reset")).toBe(0);

    const right = await run(twoFactorReset, ["--org-id", orgId, "--user-id", userId, "--confirm", ` ${orgName} `]);
    expect(right.code).toBe(0);
    expect(right.stdout).toContain(`user ${userId}: two-factor sign-in reset`);
    expect(await twoFactorRows(userId)).toBe(0);
    expect(await auditCount(orgId, "web.two_factor_reset")).toBe(1);
  });

  test("9b. a user of another organization with the right name: the same refusal and code as before", async () => {
    const member = await createOwner({ twoFactor: true, breakGlass: false });
    const other = await createOwner({ twoFactor: true, breakGlass: false });
    const result = await run(twoFactorReset, [
      "--org-id",
      member.orgId,
      "--user-id",
      other.userId,
      "--confirm",
      member.orgName,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("user is not a member of this organization");
    expect(await twoFactorRows(other.userId)).toBe(1);
  });
});

describe("danger tools: bad arguments", () => {
  test("8. --org-id not-a-uuid: exit 2 for each of the five tools", async () => {
    const calls: [string, string[]][] = [
      [breakGlass, ["--org-id", "not-a-uuid"]],
      [twoFactorReset, ["--org-id", "not-a-uuid", "--user-id", randomUUID(), "--confirm", "x"]],
      [resolve(scripts, "org-delete.ts"), ["--org-id", "not-a-uuid", "--confirm", "x"]],
      [resolve(scripts, "org-dsr.ts"), ["--org-id", "not-a-uuid", "--rule-check"]],
      [resolve(scripts, "org-export.ts"), ["--org-id", "not-a-uuid", "--recipient", "age1x", "--out", "/tmp/x.age"]],
    ];
    for (const [script, args] of calls) {
      const result = await run(script, args);
      expect([script, result.code]).toEqual([script, 2]);
    }
  });
});
