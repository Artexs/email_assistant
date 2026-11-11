import { randomUUID } from "node:crypto";

import { activityPageSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { activityRoutes } from "../../src/modules/reports";
import { insertFeedback } from "../../src/modules/triage/repo";

import { insertTriagedWithActions, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const HOUR = 3_600_000;

const orgs: WebOrg[] = [];

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
    address: `activity-${id}@x.test`,
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

async function addMail(
  orgId: string,
  mailboxId: string,
  category: "notification" | "needs_reply" | "unsure" | "info",
  hoursAgo: number,
  uid: number
): Promise<string> {
  const at = new Date(NOW.getTime() - hoursAgo * HOUR);
  const mail = await db.transaction().execute((trx) =>
    insertTriagedWithActions(
      trx,
      { orgId },
      mailboxId,
      category === "notification"
        ? {
            category,
            createdAt: at,
            subject: `Mail ${uid}`,
            from: "sender@x.test",
            uid,
            actions: [{ type: "move", status: "applied", appliedAt: at }],
          }
        : { category, createdAt: at, subject: `Mail ${uid}`, from: "sender@x.test", uid, actions: [] }
    )
  );
  return mail.emailId;
}

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const mine = await addMailbox(org.orgId);
  const theirs = await addMailbox(org.otherOrgId);
  const m1 = await addMail(org.orgId, mine, "notification", 1, 1);
  const m2 = await addMail(org.orgId, mine, "needs_reply", 2, 2);
  const m3 = await addMail(org.orgId, mine, "unsure", 3, 3);
  const foreign = await addMail(org.otherOrgId, theirs, "info", 1, 1);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", activityRoutes({ db, now: () => NOW })),
  });
  return { org, app, mine, theirs, m1, m2, m3, foreign };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
  return res.json();
}

describe("GET /activity", () => {
  test("matrix: 401 without a cookie, 200 for owner and assistant, 400 for bad queries", async () => {
    const { app } = await setup();
    expect((await app.request("/api/activity")).status).toBe(401);
    expect((await app.request("/api/activity", as("owner"))).status).toBe(200);
    expect((await app.request("/api/activity", as("assistant"))).status).toBe(200);

    const limit = await app.request("/api/activity?limit=0", as("owner"));
    expect(limit.status).toBe(400);
    const limitBody = await json(limit);
    expect(limitBody.error).toBe("validation");
    expect(limitBody.details[0].path).toBe("limit");

    expect((await app.request("/api/activity?categories=bogus", as("owner"))).status).toBe(400);
    expect((await app.request("/api/activity?mailboxId=nope", as("owner"))).status).toBe(400);

    const before = await app.request("/api/activity?before=%%%", as("owner"));
    expect(before.status).toBe(400);
    const beforeBody = await json(before);
    expect(beforeBody.error).toBe("validation");
    expect(beforeBody.details[0]).toMatchObject({ path: "before", code: "invalid_cursor" });
  });

  test("returns the own organization's items newest first and nothing of another organization", async () => {
    const { app, theirs, m1, m2, m3, foreign } = await setup();
    const own = activityPageSchema.parse(await json(await app.request("/api/activity", as("owner"))));
    expect(own.items.map((i) => i.emailId)).toEqual([m1, m2, m3]);
    expect(own.nextBefore).toBeNull();

    const other = activityPageSchema.parse(await json(await app.request("/api/activity", as("other"))));
    expect(other.items.map((i) => i.emailId)).toEqual([foreign]);

    const crossed = await app.request(`/api/activity?mailboxId=${theirs}`, as("owner"));
    expect(crossed.status).toBe(200);
    expect(await json(crossed)).toEqual({ items: [], nextBefore: null });
  });

  test("filters by categories and by not rated", async () => {
    const { app, org, m1, m2, m3 } = await setup();
    const picked = activityPageSchema.parse(
      await json(await app.request("/api/activity?categories=urgent,needs_reply,unsure", as("owner")))
    );
    expect(picked.items.map((i) => i.emailId)).toEqual([m2, m3]);

    await insertFeedback(
      db,
      { orgId: org.orgId },
      {
        emailId: m2,
        verdict: "right",
        trueCategory: "needs_reply",
        source: "web",
        userId: org.ownerId,
      }
    );
    const unrated = activityPageSchema.parse(await json(await app.request("/api/activity?notRated=true", as("owner"))));
    expect(unrated.items.map((i) => i.emailId)).toEqual([m1, m3]);
  });

  test("pages with the cursor", async () => {
    const { app, m1, m2, m3 } = await setup();
    const first = activityPageSchema.parse(await json(await app.request("/api/activity?limit=2", as("owner"))));
    expect(first.items.map((i) => i.emailId)).toEqual([m1, m2]);
    expect(first.nextBefore).not.toBeNull();

    const second = activityPageSchema.parse(
      await json(
        await app.request(`/api/activity?limit=2&before=${encodeURIComponent(first.nextBefore ?? "")}`, as("owner"))
      )
    );
    expect(second.items.map((i) => i.emailId)).toEqual([m3]);
    expect(second.nextBefore).toBeNull();
  });

  test("a 400 body never holds the input", async () => {
    const { app } = await setup();
    const junk = "JUNKVALUE".repeat(40);
    const res = await app.request(`/api/activity?categories=${junk}`, as("owner"));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("JUNKVALUE");
  });
});
