import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { E2E_OWNER_EMAIL } from "../../src/scripts/e2e-seed-args";

import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/e2e-seed.ts");

afterAll(async () => {
  await db.destroy();
});

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function runSeed(env: Record<string, string>) {
  const proc = Bun.spawn(["bun", script], {
    cwd: repoRoot,
    env: { ...process.env, WEB_BASE_URL: "http://127.0.0.1:8080", WEB_AUTH_SECRET: "x".repeat(40), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return {
    code,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

async function e2eOrgCount(): Promise<number> {
  const row = await db
    .selectFrom("organizations")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("name", "=", "E2E")
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

describe("e2e seed guards", () => {
  const appUrl = process.env.DATABASE_URL ?? "";

  test("refuses the test database and touches nothing", async () => {
    const before = await e2eOrgCount();
    await db.deleteFrom("users").where("email", "=", E2E_OWNER_EMAIL).execute();
    await db.insertInto("users").values({ email: E2E_OWNER_EMAIL, display_name: "Survivor" }).execute();
    const result = await runSeed({ DATABASE_URL: appUrl, MIGRATOR_DATABASE_URL: appUrl });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refusing: DATABASE_URL is not an e2e database");
    expect(await e2eOrgCount()).toBe(before);
    expect(before).toBe(0);
    const survivor = await db.selectFrom("users").select("id").where("email", "=", E2E_OWNER_EMAIL).execute();
    expect(survivor).toHaveLength(1);
    await db.deleteFrom("users").where("email", "=", E2E_OWNER_EMAIL).execute();
  });

  test("refuses a migrator URL that is not an e2e database, before any connection", async () => {
    const result = await runSeed({
      DATABASE_URL: withDatabase(appUrl, "email_assistant_e2e"),
      MIGRATOR_DATABASE_URL: appUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refusing: MIGRATOR_DATABASE_URL is not an e2e database");
    expect(result.stderr).not.toMatch(/ECONNREFUSED|does not exist|password authentication|connect/i);
  });
});
