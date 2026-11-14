import { randomBytes, randomUUID } from "node:crypto";

import { operatorOrgListSchema, type OperatorOrgList } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { recordLlmCall } from "../../src/modules/audit";
import { insertOutbox } from "../../src/modules/channels";
import { insertMailbox } from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { insertAction, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F099 stage 07: GET /api/operator/orgs (plan D13 to D18).
const db = testDb();
const key = randomBytes(32).toString("base64");
const testConfig = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  CREDENTIALS_KEY: key,
  WEB_BASE_URL: TEST_ORIGIN,
  WEB_AUTH_SECRET: "x".repeat(32),
});
const extras = {
  secrets: createSecretBox(key, 1),
  actionsScope: { kind: "off" } as const,
  botUsername: null,
};
const NOW = new Date("2026-11-20T10:00:00Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

let org: WebOrg;
const sessions = () => ({ owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId });
const app = () =>
  webTestApp({
    db,
    sessions: sessions(),
    routers: apiRouters(
      testConfig,
      db,
      extras,
      () => NOW,
      async () => [],
      noBackupCodes,
      noPrivacy
    ),
    operatorUserIds: new Set([org.assistantId]),
  });
const rowOf = (body: OperatorOrgList, orgId: string) => body.orgs.find((row) => row.orgId === orgId);

async function insertMailboxRow(
  orgId: string,
  status: "active" | "auth_error" | "host_blocked",
  lastSyncedAt: Date | null
) {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address: `operator-orgs-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    }
  );
  await db
    .updateTable("mailboxes")
    .set({ status, last_synced_at: lastSyncedAt })
    .where("org_id", "=", orgId)
    .where("id", "=", id)
    .execute();
  return id;
}

beforeAll(async () => {
  org = await webOrg(db);
  const ctx = { orgId: org.orgId };
  const active = await insertMailboxRow(org.orgId, "active", at(-5 * MINUTE));
  await insertMailboxRow(org.orgId, "auth_error", null);
  await insertMailboxRow(org.otherOrgId, "active", null);
  await insertMailboxRow(org.otherOrgId, "host_blocked", null);
  await db
    .insertInto("chat_links")
    .values({
      org_id: org.orgId,
      user_id: org.ownerId,
      channel: "telegram",
      external_chat_id: 900_000_000_000 + Math.floor(Math.random() * 99_000_000_000),
      linked_at: at(-HOUR),
    })
    .execute();
  const emailId = await insertTestEmail(db as never, ctx, active);
  const sendId = await insertAction(db as never, ctx, emailId, { type: "send", status: "failed" });
  await db
    .updateTable("actions")
    .set({ updated_at: at(-2 * HOUR) })
    .where("id", "=", sendId)
    .execute();
  const dedupKey = `sync_ok:${randomUUID()}`;
  await insertOutbox(db, ctx, {
    userId: org.ownerId,
    kind: "sync_ok",
    dedupKey,
    mailboxId: active,
    view: {},
    locale: "en",
    createdAt: at(-HOUR),
    nextAttemptAt: at(-HOUR),
  });
  await db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "bad_request" })
    .where("org_id", "=", org.orgId)
    .where("dedup_key", "=", dedupKey)
    .execute();
  const call = (model: string, when: string, tokens: number | null) =>
    recordLlmCall(db, ctx, {
      mailboxId: active,
      role: "classifier",
      promptVersion: "p1",
      model,
      outcome: "ok",
      tokensIn: tokens,
      tokensOut: tokens === null ? null : tokens / 5,
      latencyMs: 10,
      at: new Date(when),
    });
  await call("gpt-6-luna", "2026-11-20T08:00:00Z", 100_000);
  await call("gpt-6-luna", "2026-11-20T09:00:00Z", 100_000);
  await call("gpt-6-luna", "2026-11-20T09:30:00Z", 100_000);
  await call("unknown-model", "2026-11-20T09:00:00Z", null);
  await call("unknown-model", "2026-11-20T09:00:00Z", null);
  await call("gpt-6-luna", "2026-11-20T07:59:00Z", 100_000);
});

afterAll(async () => {
  // Deleting the organizations removes their rows (the cascade); the helper deletes the users.
  await org.cleanup();
  await db.destroy();
});

describe("GET /api/operator/orgs (F099 stage 07)", () => {
  test("4. no session answers 401; a user who is not an operator answers 404", async () => {
    const anon = await app().request("/api/operator/orgs", { headers: { origin: TEST_ORIGIN } });
    expect(anon.status).toBe(401);
    for (const who of ["owner", "other"]) {
      const res = await app().request("/api/operator/orgs", as(who));
      expect({ who, status: res.status, body: await res.json() }).toEqual({
        who,
        status: 404,
        body: { error: "not_found" },
      });
    }
  });

  test("5. the operator reads counts, dates and the LLM cost of the quota day", async () => {
    const res = await app().request("/api/operator/orgs", as("assistant"));
    expect(res.status).toBe(200);
    const body = operatorOrgListSchema.parse(await res.json());
    expect(body.at).toBe(NOW.toISOString());
    const a = rowOf(body, org.orgId);
    if (!a) throw new Error("organization A is missing from the list");
    const { llmToday, ...rest } = a;
    expect(rest).toMatchObject({
      members: 2,
      linkedChats: 1,
      mailboxes: { total: 2, active: 1, paused: 0, authError: 1, hostBlocked: 0 },
      lastSyncAt: at(-5 * MINUTE).toISOString(),
      failures24h: { sends: 1, outbox: 1 },
    });
    expect(llmToday).toMatchObject({ since: "2026-11-20T08:00:00.000Z", calls: 5, unpricedCalls: 2 });
    expect(llmToday.costUsd).toBeCloseTo(0.06, 10);
    const b = rowOf(body, org.otherOrgId);
    expect(b).toMatchObject({
      members: 1,
      linkedChats: 0,
      mailboxes: { total: 2, active: 1, paused: 0, authError: 0, hostBlocked: 1 },
      lastSyncAt: null,
      failures24h: { sends: 0, outbox: 0 },
      llmToday: { calls: 0, costUsd: 0, unpricedCalls: 0 },
    });
  });

  test("6. the body holds no organization name, address or display name", async () => {
    const res = await app().request("/api/operator/orgs", as("assistant"));
    const text = await res.text();
    for (const forbidden of ["Web org", "Web other org", "@x.test", "Owner", "Assistant"]) {
      expect({ forbidden, found: text.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });

  test("7. organizations come in creation order: A before B", async () => {
    const res = await app().request("/api/operator/orgs", as("assistant"));
    const ids = ((await res.json()) as OperatorOrgList).orgs.map((row) => row.orgId);
    expect(ids.indexOf(org.orgId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(org.orgId)).toBeLessThan(ids.indexOf(org.otherOrgId));
  });

  test("8. time of one GET /orgs", async () => {
    const started = performance.now();
    const res = await app().request("/api/operator/orgs", as("assistant"));
    const elapsed = Math.round(performance.now() - started);
    const body = (await res.json()) as OperatorOrgList;
    expect(res.status).toBe(200);
    if (process.env.F099_TIMING === "1") {
      console.info(`F099_TIMING GET /orgs ${elapsed} ms, ${body.orgs.length} organizations`);
    }
  });
});
