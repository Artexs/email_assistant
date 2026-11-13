import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TERMS_VERSION } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { createDb } from "../../src/platform/db";
import {
  E2E_ORG_NAME,
  E2E_PROJECTS,
  E2E_OWNER_EMAIL,
  E2E_PAUSED_ORG_NAME,
  E2E_TRIAL_ORG_NAME,
  type SeedFile,
} from "../../src/scripts/e2e-seed-args";

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

// The seed wipes and fills the e2e database: it runs only where E2E_DATABASE_URL names one (a `_e2e` database).
const e2eAppUrl = process.env.E2E_DATABASE_URL ?? "";
const e2eMigratorUrl = process.env.E2E_MIGRATOR_DATABASE_URL ?? "";

describe.skipIf(e2eAppUrl === "" || e2eMigratorUrl === "")("e2e seed of the plan states", () => {
  test("seeds a trial and a paused organization, and a second run works", async () => {
    const env = { DATABASE_URL: e2eAppUrl, MIGRATOR_DATABASE_URL: e2eMigratorUrl };
    const first = await runSeed(env);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    const second = await runSeed(env);
    expect(second.code).toBe(0);

    const seed = JSON.parse(readFileSync(resolve(repoRoot, "apps/web/e2e/.seed.json"), "utf8")) as SeedFile;
    const e2e = createDb(e2eAppUrl);
    try {
      const orgOf = (name: string) =>
        e2e
          .selectFrom("organizations")
          .select(["id", "plan", "trial_ends_at"])
          .where("name", "=", name)
          .executeTakeFirstOrThrow();

      const main = await orgOf(E2E_ORG_NAME);
      expect(main.plan).toBe("active");

      const trial = await orgOf(E2E_TRIAL_ORG_NAME);
      expect(trial.plan).toBe("trial");
      const aheadMs = (trial.trial_ends_at as Date).getTime() - Date.now();
      expect(Math.abs(aheadMs - 10 * 24 * 60 * 60 * 1000)).toBeLessThan(60_000);
      expect(seed.trialOwner.orgId).toBe(trial.id);
      expect(seed.trialOwner.trialEndsAt).toBe((trial.trial_ends_at as Date).toISOString());

      const paused = await orgOf(E2E_PAUSED_ORG_NAME);
      expect(paused.plan).toBe("suspended");
      expect(seed.pausedOwner.orgId).toBe(paused.id);
      const mailboxes = await e2e.selectFrom("mailboxes").select("id").where("org_id", "=", paused.id).execute();
      expect(mailboxes.map((row) => row.id)).toEqual([seed.pausedOwner.mailboxId]);
      const settings = await e2e
        .selectFrom("mailbox_settings")
        .select("mailbox_id")
        .where("org_id", "=", paused.id)
        .execute();
      expect(settings).toHaveLength(1);

      const termsOf = async (userId: string) =>
        (await e2e.selectFrom("users").select("terms_version").where("id", "=", userId).executeTakeFirstOrThrow())
          .terms_version;
      expect(await termsOf(seed.owner.userId)).toBe(TERMS_VERSION);
      for (const project of E2E_PROJECTS) {
        expect(await termsOf(seed.termsOwners[project].userId)).toBe("2000-01-01");
        expect(await termsOf(seed.members[project].userId)).toBe(TERMS_VERSION);
      }

      expect(seed.trialOwner.userId).not.toBe(seed.pausedOwner.userId);
      for (const owner of [seed.trialOwner, seed.pausedOwner]) {
        expect(owner.email).toMatch(/^e2e-(trial|paused)-owner@x\.test$/);
      }
    } finally {
      await e2e.destroy();
    }
  }, 60_000);
});
