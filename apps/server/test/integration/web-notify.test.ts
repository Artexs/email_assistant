import { randomUUID } from "node:crypto";

import { notifyViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import { auditEvents } from "../../src/modules/audit";
import { channelRoutes } from "../../src/modules/channels";
import { insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { ApiEnv } from "../../src/platform/http";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F110 stage 18 step 2: GET/PATCH /api/me/notify (tests 7, 8 and 9 of the stage).
const db = testDb();
const NOW = new Date("2026-11-11T10:00:00.000Z");
const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function setup(flags: { quiet?: boolean; mail?: boolean } = { quiet: true, mail: true }) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  for (const [flag, enabled] of [
    ["user_quiet_hours", flags.quiet ?? false],
    ["report_mail", flags.mail ?? false],
  ] as const) {
    if (enabled) await upsertOrgFeature(db, ctx, { flag, enabled, setBy: org.ownerId, setAt: NOW });
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, "other-owner": org.otherOwnerId },
    routers: (api: Hono<ApiEnv>) =>
      api.route("/", channelRoutes({ db, now: () => NOW, botUsername: async () => "fake_ea_bot" })),
  });
  return { org, ctx, app };
}

async function addMailbox(orgId: string, opts: { createdAt: Date; status?: "paused" }): Promise<string> {
  const id = randomUUID();
  const ctx = { orgId };
  await insertMailbox(db, ctx, {
    id,
    address: `notify-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await db.updateTable("mailboxes").set({ created_at: opts.createdAt }).where("id", "=", id).execute();
  if (opts.status) await setMailboxStatus(db, ctx, id, opts.status);
  return id;
}

const rowOf = (orgId: string, userId: string) =>
  db
    .selectFrom("memberships")
    .select(["quiet_start", "quiet_end", "report_channel", "report_mailbox_id"])
    .where("org_id", "=", orgId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

const auditOf = (orgId: string) =>
  db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.memberNotifyChanged)
    .orderBy("created_at")
    .execute();

const patch = (cookie: string, body: unknown) => as(cookie, { method: "PATCH", body });
const DEFAULT_ROW = { quiet_start: null, quiet_end: null, report_channel: "telegram", report_mailbox_id: null };

describe("GET /api/me/notify", () => {
  test("a member reads the own row and the active mailboxes, oldest first; no cookie is 401", async () => {
    const { org, app } = await setup();
    const older = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const newer = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z") });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-03T00:00:00Z"), status: "paused" });
    const res = await app.request("/api/me/notify", as("assistant"));
    expect(res.status).toBe(200);
    const view = notifyViewSchema.parse(await res.json());
    expect(view).toMatchObject({ quietStart: null, quietEnd: null, reportChannel: "telegram", reportMailboxId: null });
    expect(view.telegramLinked).toBe(false);
    expect(view.mailboxes.map((mailbox) => mailbox.id)).toEqual([older, newer]);
    const bare = await app.request("/api/me/notify", { headers: { origin: "http://127.0.0.1:8080" } });
    expect(bare.status).toBe(401);
  });
});

describe("PATCH /api/me/notify: quiet hours", () => {
  test("7. 23:00 and 06:00 are stored and audited by key name; 25:00 is 400; one of the two is 400", async () => {
    const { org, app } = await setup();
    const ok = await app.request("/api/me/notify", patch("owner", { quietStart: "23:00", quietEnd: "06:00" }));
    expect(ok.status).toBe(200);
    expect(notifyViewSchema.parse(await ok.json())).toMatchObject({ quietStart: "23:00", quietEnd: "06:00" });
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: "23:00", quiet_end: "06:00" });
    expect(await auditOf(org.orgId)).toEqual([
      { actor: org.ownerId, data: { via: "web", keys: "quiet_start,quiet_end" } },
    ]);

    for (const body of [
      { quietStart: "25:00", quietEnd: "06:00" },
      { quietStart: "23:00", quietEnd: "6:00" },
      { quietStart: "22:00" },
      { quietEnd: "07:00" },
      { quietStart: "22:00", quietEnd: null },
      { quietStart: "22:00", quietEnd: "07:00", reportChannel: "mail" },
      {},
    ]) {
      expect((await app.request("/api/me/notify", patch("owner", body))).status).toBe(400);
    }
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: "23:00", quiet_end: "06:00" });
  });

  test("both null resets to the default; the same value twice writes no second audit row", async () => {
    const { org, app } = await setup();
    const same = patch("owner", { quietStart: "21:00", quietEnd: "08:00" });
    await app.request("/api/me/notify", same);
    await app.request("/api/me/notify", same);
    expect(await auditOf(org.orgId)).toHaveLength(1);
    expect((await app.request("/api/me/notify", patch("owner", { quietStart: null, quietEnd: null }))).status).toBe(
      200
    );
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ quiet_start: null, quiet_end: null });
    expect(await auditOf(org.orgId)).toHaveLength(2);
  });

  test("with the flag off a write is 404 and stores nothing", async () => {
    const { org, app } = await setup({ mail: true });
    const res = await app.request("/api/me/notify", patch("owner", { quietStart: "23:00", quietEnd: "06:00" }));
    expect(res.status).toBe(404);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });
});

describe("PATCH /api/me/notify: report channel", () => {
  test("8. mail with no active mailbox is 409 no_mailbox; a paused mailbox does not count", async () => {
    const { org, app } = await setup();
    const none = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }));
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "no_mailbox" });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z"), status: "paused" });
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "both" }))).status).toBe(409);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect(await auditOf(org.orgId)).toEqual([]);
  });

  test("8. mail with an active mailbox stores the oldest active one, or the one asked for", async () => {
    const { org, app } = await setup();
    const oldest = await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const newer = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z") });
    const mail = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }));
    expect(mail.status).toBe(200);
    expect(notifyViewSchema.parse(await mail.json())).toMatchObject({ reportChannel: "mail", reportMailboxId: oldest });
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "mail", report_mailbox_id: oldest });

    await app.request("/api/me/notify", patch("owner", { reportChannel: "both", reportMailboxId: newer }));
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "both", report_mailbox_id: newer });
    expect((await auditOf(org.orgId)).map((row) => row.data)).toEqual([
      { via: "web", keys: "report_channel,report_mailbox_id" },
      { via: "web", keys: "report_channel,report_mailbox_id" },
    ]);
    // No address and no mailbox id in the audit row: key names only.
    expect(JSON.stringify(await auditOf(org.orgId))).not.toContain("@");
    expect(JSON.stringify(await auditOf(org.orgId))).not.toContain(newer);

    // telegram, or null, clears the mailbox.
    await app.request("/api/me/notify", patch("owner", { reportChannel: null }));
    expect(await rowOf(org.orgId, org.ownerId)).toMatchObject({ report_channel: "telegram", report_mailbox_id: null });
  });

  test("a mailbox of another organization, a paused mailbox and a bad id are refused; telegram needs no mailbox", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const foreign = await addMailbox(org.otherOrgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    const paused = await addMailbox(org.orgId, { createdAt: new Date("2026-11-02T00:00:00Z"), status: "paused" });
    for (const reportMailboxId of [foreign, paused]) {
      const res = await app.request("/api/me/notify", patch("owner", { reportChannel: "mail", reportMailboxId }));
      expect(res.status).toBe(409);
    }
    expect(
      (await app.request("/api/me/notify", patch("owner", { reportChannel: "mail", reportMailboxId: "x" }))).status
    ).toBe(400);
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "telegram" }))).status).toBe(200);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });

  test("with the flag report_mail off a write is 404", async () => {
    const { org, app } = await setup({ quiet: true });
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    expect((await app.request("/api/me/notify", patch("owner", { reportChannel: "mail" }))).status).toBe(404);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
  });
});

describe("PATCH /api/me/notify: whose row", () => {
  test("9. the caller's row only changes; the other members and the other organization keep their rows", async () => {
    const { org, app } = await setup();
    await addMailbox(org.orgId, { createdAt: new Date("2026-11-01T00:00:00Z") });
    await app.request("/api/me/notify", patch("assistant", { quietStart: "20:00", quietEnd: "05:00" }));
    await app.request("/api/me/notify", patch("assistant", { reportChannel: "both" }));
    expect(await rowOf(org.orgId, org.assistantId)).toMatchObject({
      quiet_start: "20:00",
      quiet_end: "05:00",
      report_channel: "both",
    });
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect(await rowOf(org.otherOrgId, org.otherOwnerId)).toEqual(DEFAULT_ROW);
    // A user id in the body is no key of the schema: 400, nothing changes.
    const named = await app.request(
      "/api/me/notify",
      patch("assistant", { quietStart: "01:00", quietEnd: "02:00", userId: org.ownerId })
    );
    expect(named.status).toBe(400);
    expect(await rowOf(org.orgId, org.ownerId)).toEqual(DEFAULT_ROW);
    expect((await auditOf(org.orgId)).every((row) => row.actor === org.assistantId)).toBe(true);
  });
});
