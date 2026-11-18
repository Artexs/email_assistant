import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { meSchema, type Me } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { Hono } from "hono";

import { auditEvents, hasAuditEvent, recordAudit, recordAuditOnce } from "../../src/modules/audit";
import { countSenderRules, insertSenderRule } from "../../src/modules/config";
import { insertMailbox } from "../../src/modules/mail/repo";
import { setMemberReportChannel, tenancyRoutes, upsertOrgFeature } from "../../src/modules/tenancy";
import { insertUser } from "../../src/modules/tenancy/repo";
import { hasEndedCheck } from "../../src/modules/trust";
import type { ApiEnv } from "../../src/platform/http";
import { approvalsWaiting, countMailboxes, homePathOf, onboardingDeps } from "../../src/web";

import { linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;
const NOW = new Date("2026-11-11T10:00:00.000Z");

const orgs: WebOrg[] = [];
let dist = "";

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "ea-onboarding-dist-"));
  mkdirSync(join(dist, "login"));
  writeFileSync(join(dist, "login/index.html"), "login page");
  writeFileSync(join(dist, "404.html"), "not found page");
});

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  rmSync(dist, { recursive: true, force: true });
  await db.destroy();
});

interface SetupOptions {
  botUsername?: (() => Promise<string>) | null;
  homePath?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  const { id: nobodyId } = await insertUser(db, { email: `web-nobody-${randomUUID()}@x.test`, displayName: "Nobody" });
  const botUsername = options.botUsername === undefined ? async () => "fake_ea_bot" : options.botUsername;
  const app: Hono<ApiEnv> = webTestApp({
    db,
    dist,
    sessions: { owner: org.ownerId, assistant: org.assistantId, nobody: nobodyId },
    ...(options.homePath ? { homePath: homePathOf(db, botUsername) } : {}),
    routers: (api) =>
      api.route(
        "/",
        tenancyRoutes({
          db,
          now: () => NOW,
          scopes: { triage: off, actions: off, send: off },
          countMailboxes: countMailboxes(db),
          approvalsWaiting: approvalsWaiting(db),
          operatorContact: null,
          sessions: async () => [],
          backupCodesLeft: noBackupCodes,
          ...onboardingDeps(db, botUsername),
        })
      ),
  });
  const cleanupNobody = async () => {
    await db.deleteFrom("users").where("id", "=", nobodyId).execute();
  };
  const originalCleanup = org.cleanup;
  org.cleanup = async () => {
    await originalCleanup();
    await cleanupNobody();
  };
  return { org, app };
}

async function meOf(app: Hono<ApiEnv>, cookie: string): Promise<Me> {
  const res = await app.request("/api/me", as(cookie));
  expect(res.status).toBe(200);
  return meSchema.parse(await res.json());
}

async function addMailbox(orgId: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address: `box-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  return id;
}

async function linkOwner(org: WebOrg): Promise<void> {
  await db.transaction().execute((trx) => linkChat(trx, { orgId: org.orgId }, org.ownerId, randomChatId(), NOW));
}

async function modeRows(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.onboardingModeKept)
    .execute();
}

describe("GET /api/me onboarding", () => {
  test("a fresh organization is open", async () => {
    const { app } = await setup();
    const me = await meOf(app, "owner");
    expect(me.onboarding).toEqual({
      mailbox: false,
      telegram: false,
      telegramAvailable: true,
      mode: false,
      rules: 0,
      trust: false,
      channel: false,
      report: false,
      done: false,
    });
    expect(me.telegram).toEqual({ available: true, linked: false, botUsername: "fake_ea_bot" });
  });

  test("a mailbox, a link and a mode row close it; the Telegram item is per user", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId);
    await linkOwner(org);
    await recordAudit(db, { orgId: org.orgId }, { actor: org.ownerId, event: auditEvents.mailboxModeChanged });
    const owner = await meOf(app, "owner");
    expect(owner.onboarding).toMatchObject({ mailbox: true, telegram: true, mode: true, done: true });
    expect(owner.telegram.linked).toBe(true);
    const assistant = await meOf(app, "assistant");
    expect(assistant.telegram.linked).toBe(false);
    expect(assistant.onboarding).toMatchObject({ mailbox: true, telegram: false, mode: true, done: false });
  });

  test("a sender rule counts and changes nothing else", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId);
    await insertSenderRule(db, { orgId: org.orgId }, { mailboxId: null, pattern: "a@b.test", kind: "vip" });
    const me = await meOf(app, "owner");
    expect(me.onboarding).toMatchObject({ rules: 1, done: false });
  });

  test("a getMe failure leaves /api/me working", async () => {
    const { app } = await setup({
      botUsername: async () => {
        throw new Error("getMe down");
      },
    });
    const me = await meOf(app, "owner");
    expect(me.telegram).toEqual({ available: true, linked: false, botUsername: null });
  });

  test("a server without a bot never blocks done", async () => {
    const { org, app } = await setup({ botUsername: null });
    await addMailbox(org.orgId);
    await recordAudit(db, { orgId: org.orgId }, { actor: org.ownerId, event: auditEvents.mailboxModeChanged });
    const me = await meOf(app, "owner");
    expect(me.telegram).toEqual({ available: false, linked: false, botUsername: null });
    expect(me.onboarding).toMatchObject({ telegram: false, telegramAvailable: false, done: true });
  });

  test("rows of another organization do not count", async () => {
    const { org } = await setup();
    const other = { orgId: org.otherOrgId };
    await recordAudit(db, other, { actor: org.otherOwnerId, event: auditEvents.mailboxModeChanged });
    await insertSenderRule(db, other, { mailboxId: null, pattern: "c@d.test", kind: "vip" });
    const ctx = { orgId: org.orgId };
    expect(await hasAuditEvent(db, ctx, [auditEvents.mailboxModeChanged, auditEvents.onboardingModeKept])).toBe(false);
    expect(await countSenderRules(db, ctx)).toBe(0);
    expect(await countSenderRules(db, other)).toBe(1);
  });
});

// With `trust_ladder` on, the steps are mailbox, channel, report. Counts and flags only.
describe("GET /api/me onboarding with the flag trust_ladder", () => {
  async function flagOn(orgId: string): Promise<void> {
    await upsertOrgFeature(db, { orgId }, { flag: "trust_ladder", enabled: true, setBy: "test", setAt: NOW });
  }
  async function addCheck(
    orgId: string,
    mailboxId: string,
    status: "done" | "no_result" | "classifying"
  ): Promise<void> {
    const ended = status !== "classifying";
    await db
      .insertInto("history_checks")
      .values({
        org_id: orgId,
        mailbox_id: mailboxId,
        reason: "connect",
        status,
        no_result_reason: status === "no_result" ? "no_history" : null,
        finished_at: ended ? NOW : null,
      })
      .execute();
  }

  test("a mailbox and a link do not close it until a check ended; done or no_result both close it", async () => {
    const { org, app } = await setup();
    await flagOn(org.orgId);
    const mailboxId = await addMailbox(org.orgId);
    await linkOwner(org);
    // The mode is not chosen and is not asked for.
    expect((await meOf(app, "owner")).onboarding).toMatchObject({
      trust: true,
      report: false,
      done: false,
      mode: false,
    });
    await addCheck(org.orgId, mailboxId, "classifying");
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ report: false, done: false });
    await addCheck(org.orgId, mailboxId, "no_result");
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ channel: true, report: true, done: true });
    await db.deleteFrom("history_checks").where("org_id", "=", org.orgId).execute();
    await addCheck(org.orgId, mailboxId, "done");
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ report: true, done: true });
  });

  test("the report channel `mail` counts as a channel for the member of the row only", async () => {
    const { org, app } = await setup();
    await flagOn(org.orgId);
    const mailboxId = await addMailbox(org.orgId);
    await addCheck(org.orgId, mailboxId, "done");
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ channel: false, done: false });
    await setMemberReportChannel(db, { orgId: org.orgId }, org.ownerId, { channel: "mail", mailboxId });
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ channel: true, telegram: false, done: true });
    expect((await meOf(app, "assistant")).onboarding).toMatchObject({ channel: false, done: false });
  });

  test("a check of another organization does not count; with the flag off nothing changes", async () => {
    const { org, app } = await setup();
    const mailboxId = await addMailbox(org.orgId);
    await linkOwner(org);
    await flagOn(org.otherOrgId);
    const otherMailboxId = await addMailbox(org.otherOrgId);
    await addCheck(org.otherOrgId, otherMailboxId, "done");
    expect(await hasEndedCheck(db, { orgId: org.otherOrgId })).toBe(true);
    expect(await hasEndedCheck(db, { orgId: org.orgId })).toBe(false);
    // Flag off here: a finished check of this organization changes nothing, the mode still decides.
    await addCheck(org.orgId, mailboxId, "done");
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ trust: false, report: false, done: false });
    // Flag on here, no check of its own: the check of the other organization does not close it.
    await db.deleteFrom("history_checks").where("org_id", "=", org.orgId).execute();
    await flagOn(org.orgId);
    expect((await meOf(app, "owner")).onboarding).toMatchObject({ trust: true, report: false, done: false });
  });
});

describe("recordAuditOnce", () => {
  test("an event of another organization does not block this one", async () => {
    const { org } = await setup();
    const event = { actor: org.otherOwnerId, event: auditEvents.onboardingModeKept };
    expect(await recordAuditOnce(db, { orgId: org.otherOrgId }, event)).toBe(true);
    const mine = { actor: org.ownerId, event: auditEvents.onboardingModeKept };
    expect(await recordAuditOnce(db, { orgId: org.orgId }, mine)).toBe(true);
    expect(await modeRows(org.orgId)).toHaveLength(1);
    expect(await recordAuditOnce(db, { orgId: org.orgId }, mine)).toBe(false);
    expect(await modeRows(org.orgId)).toHaveLength(1);
  });
});

describe("POST /api/onboarding/keep-mode", () => {
  const post = (cookie: string) => as(cookie, { method: "POST" });

  test("the owner keeps the mode once; a second call writes nothing", async () => {
    const { org, app } = await setup();
    const first = await app.request("/api/onboarding/keep-mode", post("owner"));
    expect(first.status).toBe(204);
    const second = await app.request("/api/onboarding/keep-mode", post("owner"));
    expect(second.status).toBe(204);
    expect(await modeRows(org.orgId)).toEqual([{ actor: org.ownerId, data: { via: "web" } }]);
    expect((await meOf(app, "owner")).onboarding.mode).toBe(true);
  });

  test("answers 403 for an assistant, 403 without Origin and 401 without a cookie", async () => {
    const { org, app } = await setup();
    const assistant = await app.request("/api/onboarding/keep-mode", post("assistant"));
    expect(assistant.status).toBe(403);
    expect(await assistant.json()).toEqual({ error: "owner_only" });
    const noOrigin = await app.request("/api/onboarding/keep-mode", {
      method: "POST",
      headers: { cookie: "ea.session_token=owner" },
    });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: "bad_origin" });
    const anonymous = await app.request("/api/onboarding/keep-mode", {
      method: "POST",
      headers: { origin: TEST_ORIGIN },
    });
    expect(anonymous.status).toBe(401);
    expect(await modeRows(org.orgId)).toEqual([]);
  });
});

describe("GET / by onboarding state", () => {
  const root = (app: Hono<ApiEnv>, cookie?: string) =>
    app.request("/", cookie ? { headers: { cookie: `ea.session_token=${cookie}` } } : undefined);

  test("goes to /onboarding while open and to /activity when done", async () => {
    const { org, app } = await setup({ homePath: true });
    const open = await root(app, "owner");
    expect(open.status).toBe(302);
    expect(open.headers.get("location")).toBe("/onboarding");
    await addMailbox(org.orgId);
    await linkOwner(org);
    await recordAudit(db, { orgId: org.orgId }, { actor: org.ownerId, event: auditEvents.mailboxModeChanged });
    const done = await root(app, "owner");
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/activity");
  });

  test("goes to /onboarding for a user without a membership", async () => {
    const { app } = await setup({ homePath: true });
    const res = await root(app, "nobody");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/onboarding");
  });

  test("goes to the login page without a session", async () => {
    const { app } = await setup({ homePath: true });
    const res = await root(app);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?next=%2F");
  });

  test("falls back to /onboarding and warns when homePath throws", async () => {
    const { org } = await setup();
    const app = webTestApp({
      db,
      dist,
      sessions: { owner: org.ownerId },
      homePath: async () => {
        throw new Error("db down");
      },
      routers: (): void => undefined,
    });
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await root(app, "owner");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/onboarding");
      const lines = errorSpy.mock.calls
        .map((call) => call.join(" "))
        .filter((line) => line.includes("home_path_failed"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("error=");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
