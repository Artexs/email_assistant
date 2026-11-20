import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { format } from "node:util";

import { connectResultSchema, type ScopeEnv } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { Hono } from "hono";

import { insertDefaultSettings } from "../../src/modules/config";
import { mailRoutes, WEB_MAIL_TIMEOUTS, type OnConnected } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { setOrgFeature } from "../../src/modules/tenancy";
import { queueHistoryCheckByOperator, queueHistoryCheckOnConnect } from "../../src/modules/trust";
import { createSecretBox } from "../../src/platform/crypto";
import { createDb } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The history check at connect (web, CLI). Committed rows, two connections where a rule says "once". The OAuth connect is in
// mail-oauth-connect.test.ts. No real mailbox: the login is the in-memory fake.
const db = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the race tests");
const ownerDb = createDb(ownerUrl);
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/trust-history-check.ts");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

afterAll(async () => {
  await Promise.all([db.destroy(), ownerDb.destroy()]);
});

const orgs: WebOrg[] = [];
let logLines: string[] = [];
let spies: Mock<(...args: unknown[]) => void>[] = [];

beforeEach(() => {
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logLines.push(format(...args));
      }) as unknown as Mock<(...args: unknown[]) => void>
    );
  }
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

async function setup(opts: { flag: boolean; hook?: OnConnected }) {
  const org = await webOrg(db);
  orgs.push(org);
  await db.updateTable("organizations").set({ max_mailboxes: 10 }).where("id", "=", org.orgId).execute();
  if (opts.flag) {
    await setOrgFeature(
      db,
      { orgId: org.orgId },
      { flag: "trust_ladder", enabled: true, actor: org.ownerId, now: new Date() }
    );
  }
  const scopeEnv: ScopeEnv = { triage: "all", actions: "synthetic", send: "off" };
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId },
    routers: (api: Hono<ApiEnv>) =>
      api.route(
        "/",
        mailRoutes({
          db,
          now: () => new Date(),
          scopeEnv,
          connect: {
            db,
            secrets,
            openProvider: async () => createFakeMailProvider(),
            verifySmtp: async () => undefined,
            timeouts: WEB_MAIL_TIMEOUTS,
            // The hook that the composition root wires (web.ts).
            onConnected: opts.hook ?? queueHistoryCheckOnConnect(db),
          },
          allowLocalHosts: false,
          onRemoved: async () => undefined,
        })
      ),
  });
  return { org, app };
}

const connectBody = (address: string) => ({
  address,
  password: "s3cret pass",
  secretKind: "password",
  preset: "interia",
});
const connect = (app: Awaited<ReturnType<typeof setup>>["app"], address: string) =>
  app.request("/api/mailboxes", as("owner", { method: "POST", body: connectBody(address) }));
const checksOf = (orgId: string) =>
  db.selectFrom("history_checks").select(["mailbox_id", "status", "reason"]).where("org_id", "=", orgId).execute();
const mailboxesOf = (orgId: string) => db.selectFrom("mailboxes").select("id").where("org_id", "=", orgId).execute();
const newAddress = () => `new-${randomUUID()}@x.test`;

describe("web connect queues a history check", () => {
  test("1. flag on: one queued check with the reason connect for the new mailbox", async () => {
    const { org, app } = await setup({ flag: true });
    const res = await connect(app, newAddress());
    expect(res.status).toBe(201);
    const { id } = connectResultSchema.parse(await res.json());
    expect(await checksOf(org.orgId)).toEqual([{ mailbox_id: id, status: "queued", reason: "connect" }]);
  });

  test("2. flag off: no check", async () => {
    const { org, app } = await setup({ flag: false });
    expect((await connect(app, newAddress())).status).toBe(201);
    expect(await checksOf(org.orgId)).toEqual([]);
  });

  test("a suspended organization gets no check", async () => {
    const seeded = await seedCommitted();
    const { orgId, mailboxId } = seeded;
    try {
      await setOrgFeature(
        db,
        { orgId },
        { flag: "trust_ladder", enabled: true, actor: seeded.userId, now: new Date() }
      );
      await queueHistoryCheckOnConnect(db)({ orgId }, mailboxId);
      expect(await checksOf(orgId)).toHaveLength(1);
      await db.deleteFrom("history_checks").where("org_id", "=", orgId).execute();
      await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", orgId).execute();
      await queueHistoryCheckOnConnect(db)({ orgId }, mailboxId);
      expect(await checksOf(orgId)).toEqual([]);
    } finally {
      await drop(seeded);
    }
  });

  test("3. a hook that throws: the connect still answers 201 and the mailbox exists; one warning, no address", async () => {
    const address = newAddress();
    const { org, app } = await setup({
      flag: true,
      hook: async () => {
        throw new Error(`secret detail of ${address}`);
      },
    });
    const res = await connect(app, address);
    expect(res.status).toBe(201);
    const { id } = connectResultSchema.parse(await res.json());
    expect((await mailboxesOf(org.orgId)).map((row) => row.id)).toEqual([id]);
    expect(await checksOf(org.orgId)).toEqual([]);
    const warnings = logLines.filter((line) => line.includes("connect_hook_failed"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`mailbox_id=${id}`);
    expect(warnings[0]).toContain("error=Error");
    expect(logLines.join("\n")).not.toContain(address);
    expect(logLines.join("\n")).not.toContain("secret detail");
  });

  test("a duplicate address connects once: the loser answers 409 and runs no hook", async () => {
    let calls = 0;
    const { org, app } = await setup({
      flag: true,
      hook: async (ctx, mailboxId) => {
        calls += 1;
        await queueHistoryCheckOnConnect(db)(ctx, mailboxId);
      },
    });
    const address = newAddress();
    expect((await connect(app, address)).status).toBe(201);
    expect((await connect(app, address)).status).toBe(409);
    expect(calls).toBe(1);
    expect(await checksOf(org.orgId)).toHaveLength(1);
  });

  test("two connects of one address at once: one mailbox, one check, one hook call", async () => {
    let calls = 0;
    const { org, app } = await setup({
      flag: true,
      hook: async (ctx, mailboxId) => {
        calls += 1;
        await queueHistoryCheckOnConnect(db)(ctx, mailboxId);
      },
    });
    const address = newAddress();
    const results = await Promise.all(Array.from({ length: 4 }, () => connect(app, address)));
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await mailboxesOf(org.orgId)).toHaveLength(1);
    expect(calls).toBe(1);
    expect(await checksOf(org.orgId)).toHaveLength(1);
  });
});

describe("the hook (flag and open check)", () => {
  test("two hook calls for one mailbox make one open check, as the app role and as the table owner", async () => {
    for (const conn of [db, ownerDb]) {
      const seeded = await seedCommitted();
      const { orgId, mailboxId } = seeded;
      try {
        await setOrgFeature(
          db,
          { orgId },
          { flag: "trust_ladder", enabled: true, actor: seeded.userId, now: new Date() }
        );
        const hook = queueHistoryCheckOnConnect(conn);
        await Promise.all(Array.from({ length: 8 }, () => hook({ orgId }, mailboxId)));
        expect(await checksOf(orgId)).toEqual([{ mailbox_id: mailboxId, status: "queued", reason: "connect" }]);
      } finally {
        await drop(seeded);
      }
    }
  });
});

// A committed organization with one mailbox (and a user that the cleanup removes with the organization).
async function seedCommitted(): Promise<{ orgId: string; mailboxId: string; userId: string }> {
  return db.transaction().execute(async (trx) => {
    const org = await createOrgWithMailbox(trx);
    await insertDefaultSettings(trx, { orgId: org.orgId }, org.mailboxId);
    return org;
  });
}

// Removes committed organizations and their owners.
async function drop(...seeded: { orgId: string; userId: string }[]): Promise<void> {
  await db
    .deleteFrom("organizations")
    .where(
      "id",
      "in",
      seeded.map((row) => row.orgId)
    )
    .execute();
  await db
    .deleteFrom("users")
    .where(
      "id",
      "in",
      seeded.map((row) => row.userId)
    )
    .execute();
}

describe("trust:history-check", () => {
  async function run(...args: string[]) {
    const proc = Bun.spawn(["bun", script, ...args], {
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, out: await new Response(proc.stdout).text(), err: await new Response(proc.stderr).text() };
  }

  test("4. twice in a row: one open check; the second run names the same id and says it is open", async () => {
    const seeded = await seedCommitted();
    const { orgId, mailboxId } = seeded;
    try {
      const first = await run("--org-id", orgId, "--mailbox-id", mailboxId);
      const second = await run("--org-id", orgId, "--mailbox-id", mailboxId);
      expect(first.code).toBe(0);
      expect(second.code).toBe(0);
      const rows = await db
        .selectFrom("history_checks")
        .select(["id", "status", "reason"])
        .where("org_id", "=", orgId)
        .execute();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({ status: "queued", reason: "cli" });
      expect(first.out).toContain(`queued: check ${row?.id}, status queued`);
      expect(second.out).toContain(`already open: check ${row?.id}, status queued`);
    } finally {
      await drop(seeded);
    }
  });

  test("two CLI processes at once: one row", async () => {
    const seeded = await seedCommitted();
    const { orgId, mailboxId } = seeded;
    try {
      const runs = await Promise.all(
        Array.from({ length: 3 }, () => run("--org-id", orgId, "--mailbox-id", mailboxId))
      );
      expect(runs.map((result) => result.code)).toEqual([0, 0, 0]);
      expect(await checksOf(orgId)).toHaveLength(1);
      expect(runs.filter((result) => result.out.includes("queued: check")).length).toBe(1);
    } finally {
      await drop(seeded);
    }
  });

  test("a suspended organization, an unknown mailbox and another organization's mailbox exit 1, bad arguments exit 2, and none writes a row", async () => {
    const a = await seedCommitted();
    const b = await seedCommitted();
    try {
      await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", a.orgId).execute();
      const suspended = await run("--org-id", a.orgId, "--mailbox-id", a.mailboxId);
      expect(suspended.code).toBe(1);
      expect(suspended.err).toContain("org_suspended");

      const unknown = await run("--org-id", b.orgId, "--mailbox-id", randomUUID());
      expect(unknown.code).toBe(1);
      expect(unknown.err).toContain("not found");

      const crossed = await run("--org-id", b.orgId, "--mailbox-id", a.mailboxId);
      expect(crossed.code).toBe(1);

      const bad = await run("--org-id", "nope", "--mailbox-id", b.mailboxId);
      expect(bad.code).toBe(2);
      expect(bad.err).toContain("usage:");
      expect((await run("--org-id", b.orgId)).code).toBe(2);

      expect(await checksOf(a.orgId)).toEqual([]);
      expect(await checksOf(b.orgId)).toEqual([]);
    } finally {
      await drop(a, b);
    }
  });

  test("the service function: queued, then open, then queued again after the check ended", async () => {
    const seeded = await seedCommitted();
    const { orgId, mailboxId } = seeded;
    try {
      const first = await queueHistoryCheckByOperator(db, { orgId }, mailboxId);
      const second = await queueHistoryCheckByOperator(db, { orgId }, mailboxId);
      expect(first.kind).toBe("queued");
      expect(second.kind).toBe("open");
      await db
        .updateTable("history_checks")
        .set({ status: "done", finished_at: new Date() })
        .where("mailbox_id", "=", mailboxId)
        .execute();
      expect((await queueHistoryCheckByOperator(db, { orgId }, mailboxId)).kind).toBe("queued");
      expect(await checksOf(orgId)).toHaveLength(2);
    } finally {
      await drop(seeded);
    }
  });

  test("the operator queue as the table owner: eight at once make one open row", async () => {
    const seeded = await seedCommitted();
    const { orgId, mailboxId } = seeded;
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => queueHistoryCheckByOperator(ownerDb, { orgId }, mailboxId))
      );
      expect(results.filter((result) => result.kind === "queued")).toHaveLength(1);
      expect(await checksOf(orgId)).toHaveLength(1);
    } finally {
      await drop(seeded);
    }
  });
});
