import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { settingsRouteDeps } from "../../src/web";

import { insertDraftAndSend, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// On the web: PATCH /api/settings/:mailboxId/switches/reply_drafts. Committed rows; the cleanup deletes both organizations.
const db = testDb();
const NOW = new Date("2026-11-18T12:00:00Z");
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const orgs: WebOrg[] = [];

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string, opts: { oauth?: "microsoft" | "google" } = {}): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address: `switch-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
    ...(opts.oauth === undefined ? {} : { oauthProvider: opts.oauth }),
  });
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  return id;
}

async function setup(opts: { flag?: boolean } = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  if (opts.flag ?? true) await setOrgFeature(db, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
  const mine = await addMailbox(org.orgId);
  const foreign = await addMailbox(org.otherOrgId);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW, NO_TEST_SENDERS))),
  });
  return { org, ctx, app, mine, foreign };
}

const patch = (value: boolean) => ({ method: "PATCH", body: { value } });

async function stored(mailboxId: string): Promise<unknown> {
  const row = await db
    .selectFrom("mailbox_settings")
    .select("tool_switches")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return (row.tool_switches as Record<string, unknown>).reply_drafts;
}

describe("PATCH /api/settings/:mailboxId/switches/reply_drafts", () => {
  test("1. the owner sets it on and the view shows it; a member gets 403 and nothing is stored", async () => {
    const { app, mine } = await setup();
    const url = `/api/settings/${mine}/switches/reply_drafts`;

    const member = await app.request(url, as("assistant", patch(true)));
    expect({ status: member.status, body: await member.json() }).toEqual({
      status: 403,
      body: { error: "owner_only" },
    });
    expect(await stored(mine)).not.toBe(true);

    const owner = await app.request(url, as("owner", patch(true)));
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({
      changed: true,
      expired: 0,
      settings: { toolSwitches: { reply_drafts: true } },
    });
    expect(await stored(mine)).toBe(true);
  });

  test("a member gets the same 403 for an unknown id and for a mailbox of another organization", async () => {
    const { app, foreign } = await setup();
    for (const id of [UNKNOWN, foreign]) {
      const res = await app.request(`/api/settings/${id}/switches/reply_drafts`, as("assistant", patch(true)));
      expect({ status: res.status, body: await res.json() }).toEqual({ status: 403, body: { error: "owner_only" } });
    }
    expect(await stored(foreign)).not.toBe(true);
  });

  test("an owner gets 404 for an unknown id and for a mailbox of another organization; nothing is stored", async () => {
    const { app, foreign } = await setup();
    for (const id of [UNKNOWN, foreign]) {
      const res = await app.request(`/api/settings/${id}/switches/reply_drafts`, as("owner", patch(true)));
      expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    }
    expect(await stored(foreign)).not.toBe(true);
  });

  test("the flag reply_drafts off hides the switch: 404, nothing is stored", async () => {
    const { app, mine } = await setup({ flag: false });
    const res = await app.request(`/api/settings/${mine}/switches/reply_drafts`, as("owner", patch(true)));
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await stored(mine)).not.toBe(true);
  });

  test("2. off closes the open reply sends and leaves a delegation send; the answer counts them", async () => {
    const { app, ctx, mine } = await setup();
    await db.updateTable("mailbox_settings").set({ mode: "assist" }).where("mailbox_id", "=", mine).execute();
    const url = `/api/settings/${mine}/switches/reply_drafts`;
    expect((await app.request(url, as("owner", patch(true)))).status).toBe(200);
    const createdAt = new Date(NOW.getTime() - HOUR_MS);
    const replyA = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, ctx, mine, { kind: "reply", createdAt }));
    const replyB = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, ctx, mine, { kind: "reply", createdAt }));
    const delegation = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, ctx, mine, { kind: "delegation", createdAt }));

    const res = await app.request(url, as("owner", patch(false)));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      changed: true,
      expired: 2,
      settings: { toolSwitches: { reply_drafts: false } },
    });
    const rows = await db
      .selectFrom("actions")
      .select(["id", "status", "status_reason"])
      .where("id", "in", [replyA.sendId, replyB.sendId, delegation.sendId])
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const reply of [replyA, replyB]) {
      expect(byId.get(reply.sendId)).toMatchObject({ status: "expired", status_reason: "policy_changed" });
    }
    expect(byId.get(delegation.sendId)?.status).toBe("awaiting_approval");
  });

  test("4. an OAuth mailbox: on answers 400 validation with the field reply_drafts and stores nothing; off is stored", async () => {
    const { org, app } = await setup();
    const oauth = await addMailbox(org.orgId, { oauth: "microsoft" });
    const url = `/api/settings/${oauth}/switches/reply_drafts`;

    const on = await app.request(url, as("owner", patch(true)));
    const body = (await on.json()) as { error: string; details: { path: string; message: string }[] };
    expect(on.status).toBe(400);
    expect(body.error).toBe("validation");
    expect(body.details).toEqual([expect.objectContaining({ path: "reply_drafts", message: "oauth_mailbox" })]);
    expect(await stored(oauth)).not.toBe(true);
    const audits = await db
      .selectFrom("audit_log")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("event", "=", "mailbox.switch_changed")
      .where(sql<string>`data->>'mailbox_id'`, "=", oauth)
      .execute();
    expect(audits).toEqual([]);

    // Off is always accepted (also when the stored value is already off), and a stored `true` goes off.
    const same = await app.request(url, as("owner", patch(false)));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ changed: false });
    await db
      .updateTable("mailbox_settings")
      .set({ tool_switches: { reply_drafts: true } })
      .where("mailbox_id", "=", oauth)
      .execute();
    const off = await app.request(url, as("owner", patch(false)));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ changed: true });
    expect(await stored(oauth)).toBe(false);
  });
});
