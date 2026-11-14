import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner, setBreakGlassOwner } from "../../src/modules/tenancy";

import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/web-two-factor-reset.ts");

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length > 0) {
    await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
  }
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

// Committed rows, so the spawned script sees them: an owner with the second factor on, a session and the mark.
async function createEnrolledOwner() {
  const email = `reset-cli-${randomUUID()}@x.test`;
  const orgName = `Secret Org ${randomUUID()}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName,
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${userId}`.execute(db);
  await sql`INSERT INTO auth_two_factors (user_id, secret, backup_codes, verified) VALUES (${userId}, 'x', 'x', true)`.execute(
    db
  );
  await sql`INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (${userId}, ${randomUUID()}, now() + interval '1 day')`.execute(
    db
  );
  await sql`INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (${userId}, ${randomUUID()}, now() + interval '1 day')`.execute(
    db
  );
  await setBreakGlassOwner(db, { orgId }, { userId, actor: "cli", now: new Date() });
  return { orgId, userId, email, orgName };
}

const counts = async (userId: string) => {
  const rows = await sql<{ rows: string; sessions: string; flag: boolean }>`
    SELECT (SELECT count(*) FROM auth_two_factors WHERE user_id = ${userId}) AS rows,
           (SELECT count(*) FROM auth_sessions WHERE user_id = ${userId}) AS sessions,
           (SELECT two_factor_enabled FROM users WHERE id = ${userId}) AS flag`.execute(db);
  const row = rows.rows[0];
  return { rows: Number(row?.rows), sessions: Number(row?.sessions), flag: row?.flag };
};

describe("web:two-factor-reset CLI", () => {
  test("9a. an enrolled member: exit 0, the ids, no address, no organization name, the rows are reset", async () => {
    const { orgId, userId, email, orgName } = await createEnrolledOwner();
    expect(await counts(userId)).toEqual({ rows: 1, sessions: 2, flag: true });

    const result = await run(["--org-id", orgId, "--user-id", userId]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`user ${userId}: two-factor sign-in reset; 2 sessions ended`);
    expect(result.stdout).toContain(`user ${userId}: break-glass cleared in ${orgId}`);
    for (const text of [result.stdout, result.stderr]) {
      expect(text).not.toContain(email);
      expect(text).not.toContain("@");
      expect(text).not.toContain(orgName);
    }
    expect(await counts(userId)).toEqual({ rows: 0, sessions: 0, flag: false });

    const again = await run(["--org-id", orgId, "--user-id", userId]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("0 sessions ended (it was off)");
    expect(again.stdout).not.toContain("break-glass");
    expect(again.stdout).not.toContain("@");
  });

  test("9b. a user of another organization: exit 1 and nothing changes", async () => {
    const member = await createEnrolledOwner();
    const other = await createEnrolledOwner();

    const result = await run(["--org-id", member.orgId, "--user-id", other.userId]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("user is not a member");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("@");
    expect(await counts(other.userId)).toEqual({ rows: 1, sessions: 2, flag: true });
  });

  test("9c. a bad argument: the usage on stderr, exit 1", async () => {
    const result = await run(["--org-id", "nope"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage: bun run web:two-factor-reset");
  });
});
