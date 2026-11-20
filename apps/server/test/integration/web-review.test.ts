import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  PANEL_REVIEW_SIZE,
  reviewLabelResultSchema,
  reviewSampleSchema,
  type PanelReviewSample,
  HOUR_MS,
  DAY_MS,
} from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";

import { getMailboxSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { insertTriageResult, REVIEW_PAGE_SIZE, reviewRoutes } from "../../src/modules/triage";
import type { Db } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";

import { insertDelegate, insertTestEmail } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The panel review routes: GET /api/review/sample and POST /api/review/label. Committed rows; `afterEach` removes the
// organizations. Mail text of these tests is made up.
const db = testDb();
const NOW = new Date("2026-11-20T12:00:00Z");

interface Box {
  org: WebOrg;
  mailboxId: string;
  otherMailboxId: string;
  clock: { now: Date };
  app: Hono<ApiEnv>;
}

let box: Box;
const made: (() => Promise<void>)[] = [];

async function newBox(opts: { flag?: boolean } = {}): Promise<Box> {
  const org = await webOrg(db);
  const mailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.orgId }));
  const otherMailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.otherOrgId }));
  for (const orgId of [org.orgId, org.otherOrgId]) {
    await upsertOrgFeature(
      db,
      { orgId },
      { flag: "panel_review", enabled: opts.flag ?? true, setBy: "test", setAt: NOW }
    );
  }
  const clock = { now: NOW };
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", reviewRoutes({ db, now: () => clock.now, testMail: NO_TEST_SENDERS })),
  });
  made.push(() => org.cleanup());
  return { org, mailboxId, otherMailboxId, clock, app };
}

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await newBox();
});
afterEach(async () => {
  for (const cleanup of made.splice(0)) await cleanup();
});
afterAll(async () => {
  await db.destroy();
});

interface MailOpts {
  receivedAt?: Date;
  category?: "info" | "unsure" | "delegation" | "spam";
  fromName?: string | null;
  address?: string;
  subject?: string;
  messageId?: string;
}

// One triaged mail with a header row (the sender name). Returns the email id.
async function addMail(db: Db, orgId: string, mailboxId: string, opts: MailOpts = {}): Promise<string> {
  const ctx = { orgId };
  return db.transaction().execute(async (trx) => {
    const emailId = await insertTestEmail(trx, ctx, mailboxId, {
      received_at: opts.receivedAt ?? new Date(NOW.getTime() - DAY_MS),
      from_address: opts.address ?? `sender-${randomUUID()}@secret.example`,
      subject: opts.subject ?? `Subject ${randomUUID()}`,
      message_id_header: opts.messageId ?? `<${randomUUID()}@real.example>`,
      status: "triaged",
    });
    await insertTriageResult(trx, ctx, {
      emailId,
      category: opts.category ?? "info",
      vip: false,
      confidence: 0.9,
      reasonCode: "llm",
      reason: null,
      fields: {},
      model: "m",
      promptVersion: "p",
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
    });
    await trx
      .insertInto("email_headers")
      .values({
        email_id: emailId,
        org_id: orgId,
        from_name: opts.fromName === undefined ? "Zofia Nowak" : opts.fromName,
        parts_known: true,
        captured_at: NOW,
      })
      .execute();
    return emailId;
  });
}

const sampleUrl = (mailboxId = box.mailboxId) => `/api/review/sample?mailboxId=${mailboxId}`;
const labelCall = (cookie: string, body: unknown) =>
  box.app.request("/api/review/label", as(cookie, { method: "POST", body }));

async function sampleOf(cookie = "owner", mailboxId = box.mailboxId): Promise<PanelReviewSample> {
  const res = await box.app.request(sampleUrl(mailboxId), as(cookie));
  expect(res.status).toBe(200);
  return reviewSampleSchema.parse(await res.json());
}

const feedbackRows = (emailId: string) =>
  db
    .selectFrom("triage_feedback")
    .select(["verdict", "true_category", "source", "user_id", "org_id"])
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .execute();

describe("GET /api/review/sample", () => {
  test("1: 12 unlabelled real mails and 1 labelled: 10 items, none labelled, no test mail, none outside 30 days, no address", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 12; n += 1) {
      ids.push(
        await addMail(db, box.org.orgId, box.mailboxId, { receivedAt: new Date(NOW.getTime() - (n + 1) * DAY_MS) })
      );
    }
    const labelled = await addMail(db, box.org.orgId, box.mailboxId, { address: "labelled-sender@secret.example" });
    expect((await labelCall("owner", { emailId: labelled, verdict: "right" })).status).toBe(200);
    const synthetic = await addMail(db, box.org.orgId, box.mailboxId, {
      messageId: "<synthetic@ea-seed.test>",
      address: "synthetic-sender@secret.example",
    });
    const old = await addMail(db, box.org.orgId, box.mailboxId, {
      receivedAt: new Date(NOW.getTime() - 40 * DAY_MS),
      address: "old-sender@secret.example",
    });
    // Mail of the other organization, in its own mailbox: never in this sample.
    const foreign = await addMail(db, box.org.otherOrgId, box.otherMailboxId);

    const res = await box.app.request(sampleUrl(), as("owner"));
    expect(res.status).toBe(200);
    const raw = await res.text();
    const sample = reviewSampleSchema.parse(JSON.parse(raw));
    expect(sample.items).toHaveLength(10);
    const got = sample.items.map((item) => item.emailId);
    expect(new Set(got).size).toBe(10);
    for (const id of got) expect(ids).toContain(id);
    for (const excluded of [labelled, synthetic, old, foreign]) expect(got).not.toContain(excluded);
    // The sender's display name shows; the address never leaves the server.
    expect(sample.items[0]?.fromName).toBe("Zofia Nowak");
    expect(raw).not.toContain("secret.example");
    expect(sample.delegation).toBe(false);
    expect(PANEL_REVIEW_SIZE).toBe(REVIEW_PAGE_SIZE);
  });

  test("2: a new request time gives a new sample; the same time gives the same one; every member gets a sample", async () => {
    for (let n = 0; n < 14; n += 1) {
      await addMail(db, box.org.orgId, box.mailboxId, { receivedAt: new Date(NOW.getTime() - (n + 1) * HOUR_MS) });
    }
    const first = await sampleOf("owner");
    expect((await sampleOf("owner")).items.map((i) => i.emailId)).toEqual(first.items.map((i) => i.emailId));
    box.clock.now = new Date(NOW.getTime() + 1000);
    const second = await sampleOf("owner");
    expect(second.items.map((i) => i.emailId)).not.toEqual(first.items.map((i) => i.emailId));
    // A member (role assistant) reads a sample of the same size.
    expect((await sampleOf("member")).items).toHaveLength(10);
  });

  test("3: an item without a sender name or with a stored AI summary shows both as stored", async () => {
    const noName = await addMail(db, box.org.orgId, box.mailboxId, { fromName: null });
    await db
      .insertInto("actions")
      .values({
        org_id: box.org.orgId,
        email_id: noName,
        type: "save_summary",
        status: "applied",
        applied_at: NOW,
        idempotency_key: `summary:${noName}`,
        payload: JSON.stringify({ summary: "A made-up summary." }),
      })
      .execute();
    const [item] = (await sampleOf()).items;
    expect(item).toMatchObject({ emailId: noName, fromName: null, category: "info", aiText: "A made-up summary." });
  });

  test("4: `delegation` is true only with an active delegate", async () => {
    await db.transaction().execute((trx) => insertDelegate(trx, { orgId: box.org.orgId }, { active: false }));
    expect((await sampleOf()).delegation).toBe(false);
    await db.transaction().execute((trx) => insertDelegate(trx, { orgId: box.org.orgId }));
    expect((await sampleOf()).delegation).toBe(true);
    // The delegate of the other organization does not count here.
    await db.transaction().execute((trx) => insertDelegate(trx, { orgId: box.org.otherOrgId }));
  });

  test("5: a mailbox of another organization, an unknown id, a bad id and a missing id are the same 404", async () => {
    const answers = [];
    for (const url of [
      sampleUrl(box.otherMailboxId),
      sampleUrl(randomUUID()),
      "/api/review/sample?mailboxId=not-a-uuid",
      "/api/review/sample",
    ]) {
      const res = await box.app.request(url, as("owner"));
      answers.push({ status: res.status, body: await res.json() });
    }
    expect(answers).toEqual(Array(4).fill({ status: 404, body: { error: "not_found" } }));
    // The owner of the other organization reads its own mailbox, not ours.
    const mine = await box.app.request(sampleUrl(box.otherMailboxId), as("other"));
    expect(mine.status).toBe(200);
    expect((await box.app.request(sampleUrl(), as("other"))).status).toBe(404);
  });

  test("6: no session is 401", async () => {
    expect((await box.app.request(sampleUrl())).status).toBe(401);
    const post = await box.app.request("/api/review/label", { method: "POST", headers: { origin: TEST_ORIGIN } });
    expect(post.status).toBe(401);
  });
});

describe("POST /api/review/label", () => {
  test("7: `right` writes one feedback row with the source review; the same again writes none", async () => {
    const emailId = await addMail(db, box.org.orgId, box.mailboxId, { category: "spam" });
    const first = await labelCall("owner", { emailId, verdict: "right" });
    expect(first.status).toBe(200);
    expect(reviewLabelResultSchema.parse(await first.json())).toEqual({
      saved: true,
      verdict: "right",
      aiCategory: "spam",
    });
    expect(await feedbackRows(emailId)).toEqual([
      { verdict: "right", true_category: "spam", source: "review", user_id: box.org.ownerId, org_id: box.org.orgId },
    ]);
    const again = await labelCall("owner", { emailId, verdict: "right" });
    expect(await again.json()).toEqual({ saved: false, verdict: "right", aiCategory: "spam" });
    expect(await feedbackRows(emailId)).toHaveLength(1);
    // The labelled mail leaves the sample.
    expect((await sampleOf()).items.map((i) => i.emailId)).not.toContain(emailId);
  });

  test("8: a category that differs is `wrong`; a member may label; a new answer after a change is saved", async () => {
    const emailId = await addMail(db, box.org.orgId, box.mailboxId, { category: "info" });
    const wrong = await labelCall("member", { emailId, category: "needs_reply" });
    expect(await wrong.json()).toEqual({ saved: true, verdict: "wrong", aiCategory: "info" });
    expect((await labelCall("member", { emailId, category: "needs_reply" })).status).toBe(200);
    expect(await feedbackRows(emailId)).toHaveLength(1);
    const changed = await labelCall("owner", { emailId, category: "urgent" });
    expect(await changed.json()).toMatchObject({ saved: true, verdict: "wrong" });
    expect((await feedbackRows(emailId)).map((row) => [row.true_category, row.source])).toEqual([
      ["needs_reply", "review"],
      ["urgent", "review"],
    ]);
  });

  test("9: `right` on an unsure mail is 409 needs_category and writes nothing; naming a category works", async () => {
    const emailId = await addMail(db, box.org.orgId, box.mailboxId, { category: "unsure" });
    const res = await labelCall("owner", { emailId, verdict: "right" });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 409, body: { error: "needs_category" } });
    expect(await feedbackRows(emailId)).toEqual([]);
    expect((await labelCall("owner", { emailId, category: "info" })).status).toBe(200);
  });

  test("10: `delegation` needs an active delegate, unless the mail already is a delegation", async () => {
    const emailId = await addMail(db, box.org.orgId, box.mailboxId, { category: "info" });
    const refused = await labelCall("owner", { emailId, category: "delegation" });
    expect({ status: refused.status, body: await refused.json() }).toEqual({
      status: 409,
      body: { error: "no_delegates" },
    });
    expect(await feedbackRows(emailId)).toEqual([]);
    await db.transaction().execute((trx) => insertDelegate(trx, { orgId: box.org.orgId }));
    expect((await labelCall("owner", { emailId, category: "delegation" })).status).toBe(200);
    const own = await addMail(db, box.org.orgId, box.mailboxId, { category: "delegation" });
    expect((await labelCall("owner", { emailId: own, verdict: "right" })).status).toBe(200);
  });

  test("11: a mail of another organization, an unknown id and a body that names no mail answer alike; nothing is written", async () => {
    const foreign = await addMail(db, box.org.otherOrgId, box.otherMailboxId);
    const answers = [];
    for (const emailId of [foreign, randomUUID()]) {
      const res = await labelCall("owner", { emailId, verdict: "right" });
      answers.push({ status: res.status, body: await res.json() });
    }
    expect(answers).toEqual(Array(2).fill({ status: 404, body: { error: "not_found" } }));
    expect(await feedbackRows(foreign)).toEqual([]);
    // The owner of that organization labels its own mail.
    expect((await labelCall("other", { emailId: foreign, verdict: "right" })).status).toBe(200);
    // A bad body is a validation error, as on the other routes.
    expect((await labelCall("owner", { emailId: "x", verdict: "right" })).status).toBe(400);
    expect((await labelCall("owner", { emailId: foreign, category: "unsure" })).status).toBe(400);
  });

  test("12: a label unlocks nothing: the settings of the mailbox stay as they were", async () => {
    const emailId = await addMail(db, box.org.orgId, box.mailboxId, { category: "info" });
    const ctx = { orgId: box.org.orgId };
    const before = await getMailboxSettings(db, ctx, box.mailboxId);
    for (let n = 0; n < 3; n += 1) {
      const id = n === 0 ? emailId : await addMail(db, box.org.orgId, box.mailboxId, { category: "info" });
      expect((await labelCall("owner", { emailId: id, verdict: "right" })).status).toBe(200);
    }
    expect(await getMailboxSettings(db, ctx, box.mailboxId)).toEqual(before);
  });
});

describe("the flag panel_review", () => {
  test("13: off, both routes are 404 for every role, with a good request and a bad one", async () => {
    const off = await newBox({ flag: false });
    const emailId = await addMail(db, off.org.orgId, off.mailboxId);
    for (const cookie of ["owner", "member"]) {
      for (const url of [`/api/review/sample?mailboxId=${off.mailboxId}`, "/api/review/sample"]) {
        const res = await off.app.request(url, as(cookie));
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
      }
      for (const body of [{ emailId, verdict: "right" }, {}]) {
        const res = await off.app.request("/api/review/label", as(cookie, { method: "POST", body }));
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
      }
    }
    expect(await feedbackRows(emailId)).toEqual([]);
  });

  test("14: the kill switch FEATURES_OFF turns it off for an organization that has the row on", async () => {
    configureFeatures({ off: ["panel_review"] });
    const res = await box.app.request(sampleUrl(), as("owner"));
    expect(res.status).toBe(404);
  });
});

describe("mail text stays out of logs", () => {
  test("15: the review code opens no logger and the routes print nothing", () => {
    for (const file of ["review-panel.ts", "review-routes.ts"]) {
      const source = readFileSync(`${import.meta.dir}/../../src/modules/triage/${file}`, "utf8");
      expect(source).not.toMatch(/createLog|console\./);
    }
  });
});
