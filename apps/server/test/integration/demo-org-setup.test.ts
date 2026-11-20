import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TERMS_VERSION, type LiveRunPlan } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { recordAudit } from "../../src/modules/audit";
import { exportDemo, IMPORT_ORG_NAME, serializeDemoSeed, type DemoSeed, type LabRun } from "../../src/modules/lab";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner, featureStates } from "../../src/modules/tenancy";
import { createAuth } from "../../src/platform/auth";
import {
  DEMO_OWNER_EMAIL,
  setupDemoOrg,
  writeDemoOwnerFile,
  type DemoOwnerFile,
  type DemoWebSettings,
} from "../../src/scripts/demo-org-setup";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";

import { insertTriaged, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

// `setupDemoOrg` on test organizations of the test DB: the seed is exported from a made-up organization (`.test` addresses),
// moved to an organization id that this database does not hold, and imported as "Kordelan demo (import)". The import organization and
// the demo owner are removed after each test.
const db = testDb();
const MARK = "f121s07";
const NOW = new Date("2026-11-30T12:00:00.000Z");
const PASSWORD = "demo-test-passphrase-42";
const WEB: DemoWebSettings = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  baseUrl: "http://127.0.0.1:8080",
  secret: "x".repeat(40),
};

const PLAN: LiveRunPlan = {
  runId: "week-20261123-aaaa",
  mode: "week",
  startDate: "2026-11-23",
  offsetDays: 0,
  scenarioDays: [1, 2, 3, 4, 5, 6, 7],
  items: [],
  endsAt: "2026-11-29T23:00:00.000Z",
  tailEndsAt: "2026-12-03T23:00:00.000Z",
  deadlines: [],
};
const RUN: LabRun = { plan: PLAN, org: "demo", capUsd: 5 };

let dir = "";
const orgIds: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "demo-org-setup-"));
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  const imported = await sql<{ id: string }>`select id from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
  const all = [...orgIds.splice(0), ...imported.rows.map((row) => row.id)];
  if (all.length > 0) await db.deleteFrom("organizations").where("id", "in", all).execute();
  await db.deleteFrom("users").where("email", "in", [DEMO_OWNER_EMAIL]).execute();
  await db.deleteFrom("users").where("email", "like", `${MARK}-%`).execute();
});
afterAll(async () => {
  await db.destroy();
});

// A seed file of a small organization: one mailbox, three triaged mails and an audit row, all on `.test` addresses.
async function writeSeed(edit: (seed: DemoSeed) => void = () => undefined): Promise<string> {
  const suffix = randomUUID();
  const orgId = await db.transaction().execute(async (trx) => {
    const { orgId: id } = await createOrganizationWithOwner(trx, {
      orgName: "Kordelan demo",
      timezone: "Europe/Warsaw",
      email: `${MARK}-owner-${suffix}@kordelan.test`,
      displayName: "Executive",
      locale: "en",
      plan: { kind: "active" },
    });
    orgIds.push(id);
    const ctx = { orgId: id };
    const mailboxId = randomUUID();
    await insertMailbox(trx, ctx, {
      id: mailboxId,
      address: `${MARK}-box-${suffix}@kordelan.test`,
      imapHost: "127.0.0.1",
      imapPort: 3143,
      smtpHost: "127.0.0.1",
      smtpPort: 3025,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    });
    await insertInboxFolder(trx, ctx, mailboxId);
    await trx
      .insertInto("mailbox_settings")
      .values({ mailbox_id: mailboxId, org_id: id, mode: "shadow", urgency_profile: JSON.stringify({ vip: [] }) })
      .execute();
    for (const [index, category] of (["info", "needs_reply", "urgent"] as const).entries()) {
      await insertTriaged(trx, ctx, mailboxId, {
        category,
        createdAt: new Date(`2026-11-${23 + index}T10:00:00.000Z`),
        subject: `Subject ${index + 1}`,
        from: `p${index}@x.test`,
      });
    }
    await recordAudit(trx, ctx, {
      actor: "system",
      event: "llm.call",
      data: { mailbox_id: mailboxId, role: "triage" },
      at: new Date("2026-11-23T10:00:00.000Z"),
    });
    return id;
  });
  const exported = await exportDemo(db, { orgId }, RUN, 3, { scenario: "lab-01", now: NOW });
  // Another database's file: the organization id is one this database does not hold.
  const seed = JSON.parse(JSON.stringify(exported).replaceAll(orgId, randomUUID())) as DemoSeed;
  edit(seed);
  const file = join(dir, `${randomUUID()}.json`);
  writeFileSync(file, serializeDemoSeed(seed));
  return file;
}

async function counts() {
  const one = async (query: ReturnType<typeof sql<{ n: string }>>) => Number((await query.execute(db)).rows[0]?.n);
  return {
    orgs: await one(sql`select count(*) as n from organizations where name = ${IMPORT_ORG_NAME}`),
    users: await one(sql`select count(*) as n from users where email = ${DEMO_OWNER_EMAIL}`),
  };
}

// The command refuses before it touches a database: a database that the e2e seed would not wipe takes no demo owner with a known password.
async function runCommand(args: string[]): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn(["bun", "apps/server/src/scripts/demo-org-setup.ts", ...args], {
    cwd: resolve(import.meta.dir, "../../../.."),
    env: { ...process.env, MIGRATOR_DATABASE_URL: process.env.DATABASE_URL ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { code, stderr };
}

describe("demo-org-setup command", () => {
  test("a database that is not an e2e database is refused before anything is imported", async () => {
    const file = await writeSeed();
    const result = await runCommand(["--seed", file, "--out", join(dir, "owner.json")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refusing: DATABASE_URL is not an e2e database");
    expect(await counts()).toEqual({ orgs: 0, users: 0 });
  });
  test.each([
    [[], "--seed is needed"],
    [["--seed", "x.json"], "--out is needed"],
    [["--seed", "x.json", "--out", "y.json", "--other", "z"], "Unknown option '--other'"],
  ])("the arguments %j are a usage error: exit 2, the usage line, nothing imported", async (args, message) => {
    const result = await runCommand(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`[demo-org-setup] ${message}`);
    expect(result.stderr).toContain("[demo-org-setup] usage: bun run demo:org-setup --seed <file> --out <file>");
    expect(await counts()).toEqual({ orgs: 0, users: 0 });
  });
});

describe("setupDemoOrg", () => {
  test("T2 the owner signs in with the password; the organization, one mailbox and activity rows are there; the terms are accepted", async () => {
    const file = await writeSeed();

    const result = await setupDemoOrg(db, { seedFile: file, ownerPassword: PASSWORD, web: WEB, sendScope: "off" });
    expect(result.ownerEmail).toBe(DEMO_OWNER_EMAIL);

    const handle = createAuth({
      databaseUrl: WEB.databaseUrl,
      baseUrl: WEB.baseUrl,
      secret: WEB.secret,
      trustedOrigins: [],
      onEvent: auditWebEvent(db),
      onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
      resetLinkTtlSeconds: 86_400,
    });
    try {
      const { response } = await handle.auth.api.signInEmail({
        body: { email: DEMO_OWNER_EMAIL, password: PASSWORD },
        returnHeaders: true,
      });
      expect(response.user.email).toBe(DEMO_OWNER_EMAIL);
    } finally {
      await handle.close();
    }

    const org = await sql<{ name: string; role: string; terms: string | null }>`
      select o.name, m.role, u.terms_version as terms from memberships m
      join organizations o on o.id = m.org_id join users u on u.id = m.user_id
      where o.id = ${result.orgId}::uuid and u.email = ${DEMO_OWNER_EMAIL}`.execute(db);
    expect(org.rows).toEqual([{ name: IMPORT_ORG_NAME, role: "owner", terms: TERMS_VERSION }]);
    const rows = await sql<{ mailboxes: string; activity: string }>`
      select (select count(*) from mailboxes where org_id = ${result.orgId}::uuid) as mailboxes,
             (select count(*) from audit_log where org_id = ${result.orgId}::uuid) as activity`.execute(db);
    expect(Number(rows.rows[0]?.mailboxes)).toBe(1);
    expect(Number(rows.rows[0]?.activity)).toBeGreaterThanOrEqual(1);
  });

  test("T3 a seed with an address outside .test fails with non_test_address and imports nothing", async () => {
    const file = await writeSeed((seed) => {
      const email = seed.tables.emails[0];
      if (email === undefined) throw new Error("fixture has no email");
      email.subject = "Ask boss@example.com";
    });
    const before = await counts();

    const failure = await setupDemoOrg(db, {
      seedFile: file,
      ownerPassword: PASSWORD,
      web: WEB,
      sendScope: "off",
    }).then(
      () => null,
      (error: unknown) => error as { code?: string }
    );

    expect(failure?.code).toBe("non_test_address");
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ orgs: 0, users: 0 });
  });

  test("T6 a second run on one database with the same seed succeeds and leaves one organization", async () => {
    const file = await writeSeed();

    const first = await setupDemoOrg(db, { seedFile: file, ownerPassword: PASSWORD, web: WEB, sendScope: "off" });
    const second = await setupDemoOrg(db, { seedFile: file, ownerPassword: PASSWORD, web: WEB, sendScope: "off" });

    expect(second.orgId).not.toBe(first.orgId);
    expect(await counts()).toEqual({ orgs: 1, users: 1 });
  });

  test("T7 the import organization has no flag on: the enabled list that /api/me returns is empty (shotFeaturesProblem passes it)", async () => {
    const file = await writeSeed();

    const { orgId } = await setupDemoOrg(db, { seedFile: file, ownerPassword: PASSWORD, web: WEB, sendScope: "off" });

    const enabled = (await featureStates(db, { orgId })).filter((state) => state.enabled).map((state) => state.flag);
    expect(enabled).toEqual([]);
  });

  test("SEND_SCOPE=all refuses the import; a missing file fails with demo_seed_unreadable", async () => {
    const file = await writeSeed();
    const refusal = await setupDemoOrg(db, {
      seedFile: file,
      ownerPassword: PASSWORD,
      web: WEB,
      sendScope: "all",
    }).then(
      () => null,
      (error: unknown) => error as { code?: string }
    );
    expect(refusal?.code).toBe("import_needs_safe_send_scope");
    await expect(
      setupDemoOrg(db, { seedFile: join(dir, "nope.json"), ownerPassword: PASSWORD, web: WEB })
    ).rejects.toThrow("demo_seed_unreadable");
    expect(await counts()).toEqual({ orgs: 0, users: 0 });
  });
});

// The demo recording (`bun run demo:record`) with source `demo` sets up through `setupDemoOrg` (`apps/web/e2e/demo/global-setup.ts` runs
// the command) and signs in with the file that the command writes. The recording of the demo-seed video is a follow-up ticket's.
describe("record setup with source demo", () => {
  test("T10 the owner file that the recording reads holds a sign-in that works for the organization that setupDemoOrg made", async () => {
    const file = await writeSeed();
    const result = await setupDemoOrg(db, { seedFile: file, ownerPassword: PASSWORD, web: WEB, sendScope: "off" });
    const ownerFile = join(dir, "nested", "owner.json");
    writeDemoOwnerFile(ownerFile, result, PASSWORD);

    const read = JSON.parse(readFileSync(ownerFile, "utf8")) as DemoOwnerFile;
    expect(read).toEqual({ orgId: result.orgId, owner: { email: DEMO_OWNER_EMAIL, password: PASSWORD } });
    const handle = createAuth({
      databaseUrl: WEB.databaseUrl,
      baseUrl: WEB.baseUrl,
      secret: WEB.secret,
      trustedOrigins: [],
      onEvent: auditWebEvent(db),
      onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
      resetLinkTtlSeconds: 86_400,
    });
    try {
      const { response } = await handle.auth.api.signInEmail({
        body: { email: read.owner.email, password: read.owner.password },
        returnHeaders: true,
      });
      expect(response.user.email).toBe(DEMO_OWNER_EMAIL);
    } finally {
      await handle.close();
    }
  });
});
