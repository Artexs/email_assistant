import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterEach, afterAll, describe, expect, test } from "bun:test";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";

import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-flag.ts");
const MISSING_ORG = "00000000-0000-4000-8000-000000000000";

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

async function run(args: string[], env: Record<string, string | undefined> = { ...process.env }) {
  const proc = Bun.spawn(["bun", script, ...args], { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  return {
    code,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

// Committed, so the spawned script sees it; the `afterEach` deletes it.
async function createOrg() {
  const orgName = `Secret Org ${randomUUID()}`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName,
    timezone: "Europe/Warsaw",
    email: `org-flag-${randomUUID()}@x.test`,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { orgId, orgName };
}

const rowsOf = (orgId: string) =>
  db.selectFrom("org_features").select(["flag", "enabled", "set_by"]).where("org_id", "=", orgId).execute();
const auditOf = (orgId: string) =>
  db.selectFrom("audit_log").select("id").where("org_id", "=", orgId).where("event", "=", "org.flag_changed").execute();

function expectNoName(result: { stdout: string; stderr: string }, orgName: string) {
  expect(result.stdout).not.toContain(orgName);
  expect(result.stderr).not.toContain(orgName);
}

describe("org:flag CLI", () => {
  test("1. list on a new organization: every flag off from the default", async () => {
    const { orgId, orgName } = await createOrg();
    const result = await run(["--org-id", orgId]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("stats_page off (default)");
    expect(result.stdout).toContain("approvals_page off (default)");
    expect(result.stdout).toContain("sent_sync off (default)");
    expect(result.stdout).toContain("security_log off (default)");
    expect(result.stdout).toContain("review_command off (default)");
    expect(result.stdout).toContain("mistake_capture off (default)");
    expect(result.stdout).toContain("weekly_report off (default)");
    expect(result.stdout).toContain("handled_share off (default)");
    expectNoName(result, orgName);
  });

  test("2. --on writes the row and one audit row; the same again changes nothing", async () => {
    const { orgId, orgName } = await createOrg();
    const args = ["--org-id", orgId, "--flag", "stats_page", "--on"];

    const first = await run(args);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("flag stats_page unset → on");
    expect(await rowsOf(orgId)).toEqual([{ flag: "stats_page", enabled: true, set_by: "cli" }]);
    expect(await auditOf(orgId)).toHaveLength(1);
    expectNoName(first, orgName);

    const second = await run(args);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already on, no change");
    expect(await auditOf(orgId)).toHaveLength(1);
    expectNoName(second, orgName);
  });

  test("3. an unknown flag: exit 1, the known keys, no row", async () => {
    const { orgId, orgName } = await createOrg();
    const result = await run(["--org-id", orgId, "--flag", "nope", "--on"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown flag; known flags: stats_page");
    expect(await rowsOf(orgId)).toEqual([]);
    expectNoName(result, orgName);
  });

  test("4. --flag alone prints the usage", async () => {
    const { orgId, orgName } = await createOrg();
    const result = await run(["--org-id", orgId, "--flag", "stats_page"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage: bun run org:flag");
    expectNoName(result, orgName);
  });

  test("5. a missing organization: exit 1 in list and set mode", async () => {
    const { orgName } = await createOrg();
    for (const args of [
      ["--org-id", MISSING_ORG],
      ["--org-id", MISSING_ORG, "--flag", "stats_page", "--on"],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("organization not found");
      expectNoName(result, orgName);
    }
  });

  test("6. FEATURES_OFF holds the flag: the write happens, the list says env", async () => {
    const { orgId, orgName } = await createOrg();
    const env = { ...process.env, FEATURES_OFF: "stats_page" };
    const written = await run(["--org-id", orgId, "--flag", "stats_page", "--on"], env);
    expect(written.code).toBe(0);
    expect(await rowsOf(orgId)).toEqual([{ flag: "stats_page", enabled: true, set_by: "cli" }]);
    expect(written.stdout).toContain("FEATURES_OFF holds stats_page");
    expectNoName(written, orgName);

    const listed = await run(["--org-id", orgId], env);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("stats_page off (env)");
    expectNoName(listed, orgName);
  });
});
