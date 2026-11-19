import { randomBytes, randomUUID } from "node:crypto";

import { SENDER_RULE_LIMIT, suggestionListSchema, suggestionResultSchema } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import { auditEvents } from "../../src/modules/audit";
import { listSenderRules } from "../../src/modules/config";
import { suggestionRoutes } from "../../src/modules/contacts";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { ApiEnv } from "../../src/platform/http";
import { apiRouters } from "../../src/web";
import { captureLogs } from "../log-capture";

import { ago, insertSuggestion, NO_TEST, NOW, seed, spamMails, withSentCoverage, type Org } from "./contacts-fixtures";
import { insertDelegate } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The suggestion routes: GET /api/suggestions/:mailboxId, POST /api/suggestions/:id/accept and /dismiss. Committed rows;
// `afterEach` removes the organizations. The addresses of these tests are made up.
const db = testDb();

interface Box {
  org: WebOrg;
  mine: Org;
  theirs: Org;
  app: Hono<ApiEnv>;
}

const made: (() => Promise<void>)[] = [];

async function setFlag(orgId: string, flag: "sender_context" | "sender_suggestions", enabled: boolean): Promise<void> {
  await upsertOrgFeature(db, { orgId }, { flag, enabled, setBy: "test", setAt: NOW });
}

async function newBox(flags: { context?: boolean; suggestions?: boolean } = {}): Promise<Box> {
  const org = await webOrg(db);
  made.push(() => org.cleanup());
  const mailboxOf = async (orgId: string): Promise<Org> => ({
    ctx: { orgId },
    mailboxId: await db.transaction().execute((trx) => addMailbox(trx, { orgId })),
    address: "",
  });
  const mine = await mailboxOf(org.orgId);
  const theirs = await mailboxOf(org.otherOrgId);
  for (const orgId of [org.orgId, org.otherOrgId]) {
    await setFlag(orgId, "sender_context", flags.context ?? true);
    await setFlag(orgId, "sender_suggestions", flags.suggestions ?? true);
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", suggestionRoutes({ db, now: () => NOW, testMail: NO_TEST })),
  });
  return { org, mine, theirs, app };
}

beforeEach(() => {
  configureFeatures({ off: [] });
});
afterEach(async () => {
  for (const cleanup of made.splice(0)) await cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const post = (who: string, id: string, action: "accept" | "dismiss", body: unknown = {}) => ({
  path: `/api/suggestions/${id}/${action}`,
  init: as(who, { method: "POST", body }),
});
const send = (box: Box, who: string, id: string, action: "accept" | "dismiss", body: unknown = {}) => {
  const call = post(who, id, action, body);
  return box.app.request(call.path, call.init);
};
const rulesOf = (box: Box) => listSenderRules(db, box.mine.ctx, box.mine.mailboxId);
const rowOf = (id: string) =>
  db.selectFrom("sender_suggestions").select(["status", "pattern"]).where("id", "=", id).executeTakeFirstOrThrow();
const auditOf = (orgId: string, event: string) =>
  db.selectFrom("audit_log").select(["actor", "data"]).where("org_id", "=", orgId).where("event", "=", event).execute();

describe("suggestion routes: guards", () => {
  test("1 no session: 401 on all three routes; a foreign or missing Origin: 403 bad_origin, and the row stays open", async () => {
    const box = await newBox();
    const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    for (const [method, path] of [
      ["GET", `/api/suggestions/${box.mine.mailboxId}`],
      ["POST", `/api/suggestions/${id}/accept`],
      ["POST", `/api/suggestions/${id}/dismiss`],
    ] as const) {
      const res = await box.app.request(path, {
        method,
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
    for (const action of ["accept", "dismiss"] as const) {
      const call = post("owner", id, action);
      for (const origin of [undefined, "https://evil.example"]) {
        const headers = { ...(call.init.headers as Record<string, string>) };
        if (origin === undefined) delete headers.origin;
        else headers.origin = origin;
        const res = await box.app.request(call.path, { ...call.init, headers });
        expect({ action, origin, status: res.status, body: await res.json() }).toEqual({
          action,
          origin,
          status: 403,
          body: { error: "bad_origin" },
        });
      }
    }
    expect(await rowOf(id)).toEqual({ status: "open", pattern: "anna@acme.pl" });
    expect(await rulesOf(box)).toEqual([]);
  });

  test("2 flag first: sender_suggestions off, or sender_context off, answers 404 for owner and member, also with a bad id or body", async () => {
    for (const flags of [{ suggestions: false }, { context: false }]) {
      const box = await newBox(flags);
      const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
      for (const who of ["owner", "member"]) {
        const calls = [
          box.app.request(`/api/suggestions/${box.mine.mailboxId}`, as(who)),
          box.app.request("/api/suggestions/not-a-uuid", as(who)),
          send(box, who, id, "accept"),
          send(box, who, id, "dismiss"),
          send(box, who, "not-a-uuid", "accept"),
          send(box, who, id, "dismiss", { unexpected: 1 }),
        ];
        for (const res of await Promise.all(calls)) {
          expect({ flags, who, status: res.status, body: await res.json() }).toEqual({
            flags,
            who,
            status: 404,
            body: { error: "not_found" },
          });
        }
      }
      expect(await rowOf(id)).toEqual({ status: "open", pattern: "anna@acme.pl" });
      expect(await rulesOf(box)).toEqual([]);
    }
  });

  test("3 a member lists, but Accept and Dismiss answer 403 owner_only and change nothing", async () => {
    const box = await newBox();
    const first = await insertSuggestion(db, box.mine, { value: "old@acme.pl", kind: "vip", createdAt: ago(5) });
    const second = await insertSuggestion(db, box.mine, {
      value: "@corp.pl",
      scope: "domain",
      kind: "whitelist",
      createdAt: ago(2),
    });
    await insertSuggestion(db, box.mine, { value: "gone@acme.pl", kind: "vip", status: "dismissed" });
    await insertSuggestion(db, box.theirs, { value: "alien@acme.pl", kind: "vip" });
    const res = await box.app.request(`/api/suggestions/${box.mine.mailboxId}`, as("member"));
    expect(res.status).toBe(200);
    const items = suggestionListSchema.parse(await res.json());
    expect(items.map((item) => item.id)).toEqual([second, first]);
    expect(items[0]).toMatchObject({ kind: "whitelist", scope: "domain", pattern: "@corp.pl" });
    expect(items[1]?.reason).toEqual({ received: 8, answered: 6 });
    expect(Date.parse(items[1]?.createdAt ?? "")).toBe(ago(5).getTime());
    for (const action of ["accept", "dismiss"] as const) {
      const denied = await send(box, "member", first, action);
      expect({ action, status: denied.status, body: await denied.json() }).toEqual({
        action,
        status: 403,
        body: { error: "owner_only" },
      });
    }
    expect(await rowOf(first)).toEqual({ status: "open", pattern: "old@acme.pl" });
    expect(await rulesOf(box)).toEqual([]);
  });

  test("4 a mailbox that is paused lists nothing (200, empty)", async () => {
    const box = await newBox();
    await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    await db.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", box.mine.mailboxId).execute();
    const paused = await box.app.request(`/api/suggestions/${box.mine.mailboxId}`, as("owner"));
    expect({ status: paused.status, body: await paused.json() }).toEqual({ status: 200, body: [] });
  });
});

describe("suggestion routes: accept and dismiss", () => {
  test("5 the owner accepts: the rule exists (a domain without the @), the row ends, audit has no address; a second accept answers 409 already", async () => {
    const box = await newBox();
    const address = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    const domain = await insertSuggestion(db, box.mine, { value: "@corp.pl", scope: "domain", kind: "whitelist" });
    const logs = captureLogs();
    const answers: unknown[] = [];
    try {
      for (const id of [address, domain, address, domain]) {
        const res = await send(box, "owner", id, "accept");
        answers.push({ status: res.status, body: await res.json() });
      }
    } finally {
      logs.stop();
    }
    expect(answers).toEqual([
      { status: 200, body: { status: "accepted" } },
      { status: 200, body: { status: "accepted" } },
      { status: 409, body: { error: "already" } },
      { status: 409, body: { error: "already" } },
    ]);
    expect(suggestionResultSchema.parse({ status: "accepted" })).toEqual({ status: "accepted" });
    const rules = await rulesOf(box);
    expect(rules.map((rule) => `${rule.kind}:${rule.pattern}`).sort()).toEqual([
      "vip:anna@acme.pl",
      "whitelist:corp.pl",
    ]);
    expect(await rowOf(address)).toEqual({ status: "accepted", pattern: null });
    const events = [
      ...(await auditOf(box.org.orgId, auditEvents.suggestionAccepted)),
      ...(await auditOf(box.org.orgId, auditEvents.ruleAdded)),
    ];
    expect(events).toHaveLength(4);
    const accepted = await auditOf(box.org.orgId, auditEvents.suggestionAccepted);
    expect(accepted.map((event) => event.data)).toEqual([
      { mailbox_id: box.mine.mailboxId, kind: "vip", scope: "address", via: "web" },
      { mailbox_id: box.mine.mailboxId, kind: "whitelist", scope: "domain", via: "web" },
    ]);
    expect(events.every((event) => event.actor === box.org.ownerId)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/acme|corp/);
    expect(logs.lines.join("\n")).not.toMatch(/acme|corp/);
  });

  test("6 two accepts at once create one rule: one answers 200, the other 409 already", async () => {
    const box = await newBox();
    const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    const answers = await Promise.all(Array.from({ length: 4 }, () => send(box, "owner", id, "accept")));
    expect(answers.map((res) => res.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await rulesOf(box)).toHaveLength(1);
    expect(await auditOf(box.org.orgId, auditEvents.suggestionAccepted)).toHaveLength(1);
  });

  test("7 Accept at the rule limit answers 409 rule_limit; the row stays open and no rule is added", async () => {
    const box = await newBox();
    await db
      .insertInto("sender_rules")
      .values(
        Array.from({ length: SENDER_RULE_LIMIT }, (_, i) => ({
          org_id: box.org.orgId,
          mailbox_id: null,
          pattern: `u${i}@limit.pl`,
          kind: "whitelist",
        }))
      )
      .execute();
    const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    const res = await send(box, "owner", id, "accept");
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 409, body: { error: "rule_limit" } });
    expect(await rowOf(id)).toEqual({ status: "open", pattern: "anna@acme.pl" });
    expect(await auditOf(box.org.orgId, auditEvents.suggestionAccepted)).toEqual([]);
  });

  test("8 the owner dismisses: 200, no rule, the pattern is cleared; a second dismiss and a later accept answer 409 already", async () => {
    const box = await newBox();
    const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    const answers: unknown[] = [];
    const logs = captureLogs();
    try {
      for (const action of ["dismiss", "dismiss", "accept"] as const) {
        const res = await send(box, "owner", id, action);
        answers.push({ status: res.status, body: await res.json() });
      }
    } finally {
      logs.stop();
    }
    expect(logs.lines.join("\n")).not.toContain("acme");
    expect(answers).toEqual([
      { status: 200, body: { status: "dismissed" } },
      { status: 409, body: { error: "already" } },
      { status: 409, body: { error: "already" } },
    ]);
    expect(await rowOf(id)).toEqual({ status: "dismissed", pattern: null });
    expect(await rulesOf(box)).toEqual([]);
    const audit = await auditOf(box.org.orgId, auditEvents.suggestionDismissed);
    expect(audit.map((event) => event.data)).toEqual([
      { mailbox_id: box.mine.mailboxId, kind: "vip", scope: "address", via: "web" },
    ]);
    expect(JSON.stringify(audit)).not.toContain("acme");
  });

  test("8b Accept of a blocklist row whose sender became a delegate answers 409 not_available: no rule, the row is withdrawn, a second tap answers 409 already", async () => {
    const box = await newBox();
    await db.transaction().execute(async (trx) => {
      await withSentCoverage(trx, box.mine);
      await seed(trx, box.mine, "spam@acme.pl", spamMails());
    });
    const id = await insertSuggestion(db, box.mine, { value: "spam@acme.pl", kind: "blocklist" });
    await db.transaction().execute((trx) => insertDelegate(trx, box.mine.ctx, { email: "spam@acme.pl" }));
    const answers: unknown[] = [];
    const logs = captureLogs();
    try {
      for (const action of ["accept", "accept"] as const) {
        const res = await send(box, "owner", id, action);
        answers.push({ status: res.status, body: await res.json() });
      }
    } finally {
      logs.stop();
    }
    expect(answers).toEqual([
      { status: 409, body: { error: "not_available" } },
      { status: 409, body: { error: "already" } },
    ]);
    expect(await rowOf(id)).toEqual({ status: "withdrawn", pattern: null });
    expect(await rulesOf(box)).toEqual([]);
    expect(await auditOf(box.org.orgId, auditEvents.suggestionAccepted)).toEqual([]);
    expect(logs.lines.join("\n")).not.toContain("acme");
  });

  test("8c the route set of the server passes the test-mail rule: a Sent mail to a configured test sender does not protect it", async () => {
    const key = randomBytes(32).toString("base64");
    const config = loadConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      CREDENTIALS_KEY: key,
      WEB_BASE_URL: TEST_ORIGIN,
      WEB_AUTH_SECRET: "x".repeat(32),
      TEST_SENDER_ADDRESSES: "spam@acme.pl",
    });
    const extras = {
      secrets: createSecretBox(key, 1),
      actionsScope: { kind: "off" } as const,
      sendScope: { kind: "off" } as const,
      botUsername: null,
    };
    const box = await newBox();
    await db.transaction().execute(async (trx) => {
      await withSentCoverage(trx, box.mine);
      await seed(trx, box.mine, "spam@acme.pl", spamMails(), [{ at: ago(1), to: ["spam@acme.pl"] }]);
    });
    const id = await insertSuggestion(db, box.mine, { value: "spam@acme.pl", kind: "blocklist" });
    const app = webTestApp({
      db,
      sessions: { owner: box.org.ownerId },
      routers: apiRouters(
        config,
        db,
        extras,
        () => NOW,
        async () => [],
        noBackupCodes,
        noPrivacy
      ),
    });
    const call = post("owner", id, "accept");
    const res = await app.request(call.path, call.init);
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { status: "accepted" } });
    expect((await rulesOf(box)).map((rule) => `${rule.kind}:${rule.pattern}`)).toEqual(["blocklist:spam@acme.pl"]);
  });

  test("9 another organization: its mailbox id and its suggestion id answer 404 and change nothing; the same for an unknown or bad id", async () => {
    const box = await newBox();
    const alien = await insertSuggestion(db, box.theirs, { value: "alien@acme.pl", kind: "vip" });
    const calls = [
      box.app.request(`/api/suggestions/${box.theirs.mailboxId}`, as("owner")),
      box.app.request(`/api/suggestions/${randomUUID()}`, as("owner")),
      box.app.request("/api/suggestions/not-a-uuid", as("owner")),
      send(box, "owner", alien, "accept"),
      send(box, "owner", alien, "dismiss"),
      send(box, "owner", randomUUID(), "accept"),
      send(box, "owner", "not-a-uuid", "dismiss"),
    ];
    for (const res of await Promise.all(calls)) {
      expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    }
    expect(await rowOf(alien)).toEqual({ status: "open", pattern: "alien@acme.pl" });
    expect(await listSenderRules(db, box.theirs.ctx, box.theirs.mailboxId)).toEqual([]);
  });

  test("10 a body that is not {} answers 400 validation for the owner", async () => {
    const box = await newBox();
    const id = await insertSuggestion(db, box.mine, { value: "anna@acme.pl", kind: "vip" });
    for (const action of ["accept", "dismiss"] as const) {
      const res = await send(box, "owner", id, action, { pattern: "boss@acme.pl" });
      const body = (await res.json()) as { error: string };
      expect({ status: res.status, error: body.error }).toEqual({ status: 400, error: "validation" });
    }
    expect(await rowOf(id)).toEqual({ status: "open", pattern: "anna@acme.pl" });
  });
});
