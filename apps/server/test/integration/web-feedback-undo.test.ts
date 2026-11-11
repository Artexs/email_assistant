import { randomUUID } from "node:crypto";

import { feedbackResultSchema, undoResultSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import type { ActionsScope } from "../../src/modules/actions";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { triageRoutes } from "../../src/modules/triage";

import { insertTriagedWithActions, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const orgs: WebOrg[] = [];
let counter = 0;

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address: `fbundo-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  return id;
}

type Kind = "committed" | "logged";

// A mail with a notification triage result. committed: move + mark_read applied; logged: only logged rows.
async function addMail(orgId: string, mailboxId: string, kind: Kind = "committed", appliedAgo = HOUR): Promise<string> {
  counter += 1;
  const at = new Date(NOW.getTime() - appliedAgo);
  const actions =
    kind === "committed"
      ? [
          { type: "move" as const, status: "applied", payload: { folder: "ai_notifications" }, appliedAt: at },
          { type: "mark_read" as const, status: "applied", appliedAt: at },
        ]
      : [
          { type: "move" as const, status: "logged", payload: { folder: "ai_notifications" } },
          { type: "mark_read" as const, status: "logged" },
        ];
  const mail = await db.transaction().execute((trx) =>
    insertTriagedWithActions(trx, { orgId }, mailboxId, {
      category: "notification",
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
      subject: `Mail ${counter}`,
      from: "sender@x.test",
      messageId: `<web-undo-${counter}@ea-seed.test>`,
      uid: counter,
      actions,
    })
  );
  return mail.emailId;
}

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const mine = await addMailbox(org.orgId);
  const theirs = await addMailbox(org.otherOrgId);
  return { org, mine, theirs };
}

function appWith(org: WebOrg, scope: ActionsScope = { kind: "synthetic" }) {
  return webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", triageRoutes({ db, now: () => NOW, actionsScope: scope })),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
  return res.json();
}

const post = (who: string, body: unknown) => as(who, { method: "POST", body });

async function feedbackRows(emailId: string) {
  return db
    .selectFrom("triage_feedback")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
}

async function reverseRows(orgId: string) {
  return db
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("reverses_action_id", "is not", null)
    .execute();
}

describe("matrix on both routes", () => {
  for (const path of ["/api/feedback", "/api/actions/undo"]) {
    test(`${path}: 401, 403, 400`, async () => {
      const { org, mine } = await setup();
      const app = appWith(org);
      const emailId = await addMail(org.orgId, mine);
      const valid = { emailId, trueCategory: "info" };

      const anon = await app.request(path, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(valid),
      });
      expect(anon.status).toBe(401);

      const noOrigin = await app.request(path, {
        method: "POST",
        headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
        body: JSON.stringify(valid),
      });
      expect(noOrigin.status).toBe(403);
      expect((await json(noOrigin)).error).toBe("bad_origin");

      for (const body of [{}, { emailId: "nope", trueCategory: "info" }]) {
        const res = await app.request(path, post("owner", body));
        expect(res.status).toBe(400);
        expect((await json(res)).error).toBe("validation");
      }

      const secret = "SECRET-VALUE-123";
      const sent = await app.request(path, post("owner", { emailId: secret, trueCategory: secret }));
      expect(sent.status).toBe(400);
      expect(JSON.stringify(await json(sent))).not.toContain(secret);

      const malformed = await app.request(path, {
        ...as("owner"),
        method: "POST",
        headers: { ...(as("owner").headers as Record<string, string>), "content-type": "application/json" },
        body: "{not json",
      });
      expect(malformed.status).toBe(400);
      const malformedBody = await json(malformed);
      expect(malformedBody.error).toBe("validation");
      expect(JSON.stringify(malformedBody)).toContain("invalid_json");
    });
  }

  test("/feedback refuses unsure and delegation", async () => {
    const { org, mine } = await setup();
    const app = appWith(org);
    const emailId = await addMail(org.orgId, mine);
    for (const trueCategory of ["unsure", "delegation"]) {
      const res = await app.request("/api/feedback", post("owner", { emailId, trueCategory }));
      expect(res.status).toBe(400);
    }
    expect(await feedbackRows(emailId)).toHaveLength(0);
  });
});

describe("another organization and unknown ids", () => {
  test("404 on both routes and no rows written", async () => {
    const { org, theirs } = await setup();
    const app = appWith(org);
    const foreign = await addMail(org.otherOrgId, theirs);
    for (const emailId of [foreign, randomUUID()]) {
      const fb = await app.request("/api/feedback", post("owner", { emailId, trueCategory: "info" }));
      expect(fb.status).toBe(404);
      expect(await json(fb)).toEqual({ error: "not_found" });
      const un = await app.request("/api/actions/undo", post("owner", { emailId }));
      expect(un.status).toBe(404);
      expect(await json(un)).toEqual({ error: "not_found" });
    }
    expect(await feedbackRows(foreign)).toHaveLength(0);
    expect(await reverseRows(org.orgId)).toHaveLength(0);
    expect(await reverseRows(org.otherOrgId)).toHaveLength(0);
  });
});

describe("POST /feedback", () => {
  test("saves, skips the same label, records the caller", async () => {
    const { org, mine } = await setup();
    const app = appWith(org);
    const emailId = await addMail(org.orgId, mine);

    const first = await app.request("/api/feedback", post("owner", { emailId, trueCategory: "notification" }));
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    expect(feedbackResultSchema.parse(firstBody)).toEqual({
      saved: true,
      verdict: "right",
      aiCategory: "notification",
    });

    const again = await app.request("/api/feedback", post("owner", { emailId, trueCategory: "notification" }));
    const againBody = feedbackResultSchema.parse(await json(again));
    expect(againBody.saved).toBe(false);

    const wrong = await app.request("/api/feedback", post("assistant", { emailId, trueCategory: "info" }));
    const wrongBody = feedbackResultSchema.parse(await json(wrong));
    expect(wrongBody).toMatchObject({ saved: true, verdict: "wrong", aiCategory: "notification" });

    const rows = await feedbackRows(emailId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "web")).toBe(true);
    expect(rows.map((r) => r.user_id).sort()).toEqual([org.ownerId, org.assistantId].sort());
  });
});

describe("POST /actions/undo", () => {
  test("any member starts an Undo; a second call is already", async () => {
    const { org, mine } = await setup();
    const app = appWith(org);
    const emailId = await addMail(org.orgId, mine);

    const res = await app.request("/api/actions/undo", post("assistant", { emailId }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(undoResultSchema.parse(body)).toEqual({ kind: "started", created: 2 });
    expect(await reverseRows(org.orgId)).toHaveLength(2);
    const rows = await feedbackRows(emailId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verdict: "wrong",
      true_category: null,
      source: "undo",
      user_id: org.assistantId,
    });

    const again = await app.request("/api/actions/undo", post("assistant", { emailId }));
    expect(again.status).toBe(200);
    expect(undoResultSchema.parse(await json(again))).toEqual({ kind: "already" });
    expect(await feedbackRows(emailId)).toHaveLength(1);
  });

  test("a web label stays the latest feedback row", async () => {
    const { org, mine } = await setup();
    const app = appWith(org);
    const emailId = await addMail(org.orgId, mine);
    const fb = await app.request("/api/feedback", post("owner", { emailId, trueCategory: "info" }));
    expect(fb.status).toBe(200);

    const res = await app.request("/api/actions/undo", post("owner", { emailId }));
    expect(undoResultSchema.parse(await json(res)).kind).toBe("started");
    const [latest] = await feedbackRows(emailId);
    expect(latest).toMatchObject({ source: "web", true_category: "info", verdict: "wrong" });
  });

  test("scope off: held, no reverse row", async () => {
    const { org, mine } = await setup();
    const app = appWith(org, { kind: "off" });
    const emailId = await addMail(org.orgId, mine);
    const res = await app.request("/api/actions/undo", post("owner", { emailId }));
    expect(res.status).toBe(200);
    expect(undoResultSchema.parse(await json(res))).toEqual({ kind: "held" });
    expect(await reverseRows(org.orgId)).toHaveLength(0);
  });

  test("too old and nothing", async () => {
    const { org, mine } = await setup();
    const app = appWith(org);
    const old = await addMail(org.orgId, mine, "committed", 8 * DAY);
    const logged = await addMail(org.orgId, mine, "logged");
    const a = await app.request("/api/actions/undo", post("owner", { emailId: old }));
    expect(undoResultSchema.parse(await json(a))).toEqual({ kind: "too_old" });
    const b = await app.request("/api/actions/undo", post("owner", { emailId: logged }));
    expect(undoResultSchema.parse(await json(b))).toEqual({ kind: "nothing" });
  });
});
