import { trustViewSchema, type TrustView } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";

import { testDb } from "./helpers";
import { insertCheckRow, insertTripRow } from "./trust-fixtures";
import { as } from "./web-helpers";
import {
  addDoneCheck,
  addExample,
  addTrip,
  gateFile,
  gateOf,
  KEY,
  NOW,
  newId,
  trustWebBox,
  type TrustWebBox,
} from "./web-trust-kit";

// GET /api/trust/:mailboxId: the one read model. Committed rows; `afterEach` removes the organizations.
const db = testDb();
let box: TrustWebBox;

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await trustWebBox(db);
});
afterEach(async () => {
  await box.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const get = async (cookie: string, mailboxId = box.mailboxId, gate?: ReturnType<typeof gateOf>) =>
  box.app(gate).request(`/api/trust/${mailboxId}`, as(cookie));

async function viewOf(cookie = "owner", gate?: ReturnType<typeof gateOf>): Promise<TrustView> {
  const res = await get(cookie, box.mailboxId, gate);
  expect(res.status).toBe(200);
  return trustViewSchema.parse(await res.json());
}

describe("GET /api/trust/:mailboxId", () => {
  test("1: an owner and a member read the same view; no session is 401", async () => {
    const owner = await viewOf("owner");
    const member = await viewOf("member");
    expect(member).toEqual(owner);
    expect(owner.mailboxId).toBe(box.mailboxId);
    expect(owner.flag).toBe(true);
    expect(owner.mode).toBe("shadow");
    expect(owner.key).toEqual(KEY);
    expect(Object.keys(owner.categories)).toEqual(["urgent", "needs_reply", "info", "notification", "spam"]);
    expect(Object.keys(owner.examples)).toEqual(["info", "notification", "spam"]);
    expect((await box.app().request(`/api/trust/${box.mailboxId}`)).status).toBe(401);
  });

  test("1: a foreign mailbox, an unknown id and a bad id answer the same 404", async () => {
    const answers = [];
    for (const id of [box.otherMailboxId, newId(), "not-a-uuid"]) {
      const res = await get("owner", id);
      answers.push({ status: res.status, body: await res.json() });
    }
    expect(answers).toEqual(Array(3).fill({ status: 404, body: { error: "not_found" } }));
    // The owner of the other organization reads its own mailbox, and not ours.
    expect((await get("other", box.otherMailboxId)).status).toBe(200);
    expect((await get("other", box.mailboxId)).status).toBe(404);
  });

  test("2: the flag off is 404 for every role, with a good id and with a bad one", async () => {
    await upsertOrgFeature(
      db,
      { orgId: box.org.orgId },
      { flag: "trust_ladder", enabled: false, setBy: "test", setAt: NOW }
    );
    for (const cookie of ["owner", "member"]) {
      for (const id of [box.mailboxId, "not-a-uuid"]) {
        const res = await get(cookie, id);
        expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
      }
    }
  });

  test("3: a done check with a fail for spam blocks spam; the examples are the acted-on mail that the category would move", async () => {
    const check = await addDoneCheck(db, box.org.orgId, box.mailboxId, {
      info: "pass",
      notification: "pass",
      spam: "fail",
    });
    const old = await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-01T10:00:00Z",
      fromName: "Old Sender",
      subject: "Oldest",
    });
    const mid = await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-05T10:00:00Z",
      fromName: "Mid Sender",
      subject: "Middle",
    });
    const new1 = await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-09T10:00:00Z",
      fromName: "New Sender",
      subject: "Newest",
    });
    const new2 = await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-07T10:00:00Z",
      fromName: "Second Sender",
      subject: "Second",
    });
    // Not shown: not acted on, not moved by the category, another category.
    await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-12T10:00:00Z",
      subject: "NOT acted",
      actedOn: false,
    });
    await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "spam",
      receivedAt: "2026-11-13T10:00:00Z",
      subject: "NOT moved",
      wouldMove: false,
    });
    const info = await addExample(db, box.org.orgId, box.mailboxId, check, {
      category: "info",
      receivedAt: "2026-11-14T10:00:00Z",
      fromName: "Info Sender",
      subject: "Info mail",
    });

    const view = await viewOf();
    expect(view.categories.spam.evidence.blocks).toContain("history_fail");
    expect(view.categories.spam.evidence.recommended).toBe(false);
    expect(view.categories.spam.history).toEqual({
      outcome: "fail",
      acted: 60,
      moved: 0,
      upper: 0.01,
      total: 200,
      wouldMove: 40,
    });
    expect(view.categories.info.evidence).toEqual({ eligible: true, recommended: true, blocks: [] });
    expect(view.categories.urgent.history).toBeNull();
    expect(view.categories.urgent.evidence.recommended).toBe(false);
    expect(view.check).toMatchObject({ status: "done", reason: "connect", noResultReason: null, capped: false });
    expect(view.check?.finishedAt).toBe("2026-11-16T12:00:00.000Z");

    // At most 3, newest first; sender name and subject.
    expect(view.examples.spam).toEqual([
      { emailId: new1, receivedAt: "2026-11-09T10:00:00.000Z", fromName: "New Sender", subject: "Newest" },
      { emailId: new2, receivedAt: "2026-11-07T10:00:00.000Z", fromName: "Second Sender", subject: "Second" },
      { emailId: mid, receivedAt: "2026-11-05T10:00:00.000Z", fromName: "Mid Sender", subject: "Middle" },
    ]);
    expect(JSON.stringify(view)).not.toContain(old);
    expect(view.examples.info.map((example) => example.emailId)).toEqual([info]);
    expect(view.examples.notification).toEqual([]);
  });

  test("3: after retention cleared the texts, the example shows without a name and a subject; the mail address never shows", async () => {
    const check = await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass" });
    const cleared = await addExample(db, box.org.orgId, box.mailboxId, check, {
      receivedAt: "2026-11-09T10:00:00Z",
      fromName: null,
      subject: null,
    });
    const noHeaders = await addExample(db, box.org.orgId, box.mailboxId, check, { receivedAt: "2026-11-08T10:00:00Z" });
    await db.updateTable("emails").set({ from_address: "secret-sender@x.test" }).where("id", "=", cleared).execute();
    const view = await viewOf();
    expect(view.examples.info).toEqual([
      { emailId: cleared, receivedAt: "2026-11-09T10:00:00.000Z", fromName: null, subject: null },
      { emailId: noHeaders, receivedAt: "2026-11-08T10:00:00.000Z", fromName: null, subject: null },
    ]);
    expect(JSON.stringify(view)).not.toContain("secret-sender");
  });

  test("3: the examples come from the newest done check only", async () => {
    const older = await addDoneCheck(
      db,
      box.org.orgId,
      box.mailboxId,
      { info: "pass" },
      new Date("2026-11-10T12:00:00Z")
    );
    await addExample(db, box.org.orgId, box.mailboxId, older, {
      receivedAt: "2026-11-02T10:00:00Z",
      subject: "from the older check",
    });
    const newer = await addDoneCheck(
      db,
      box.org.orgId,
      box.mailboxId,
      { info: "pass" },
      new Date("2026-11-16T12:00:00Z")
    );
    const kept = await addExample(db, box.org.orgId, box.mailboxId, newer, {
      receivedAt: "2026-11-03T10:00:00Z",
      subject: "from the newer check",
    });
    expect((await viewOf()).examples.info.map((example) => example.emailId)).toEqual([kept]);
  });

  test("4: no check yet gives check null, no history and no block of the history", async () => {
    const view = await viewOf();
    expect(view.check).toBeNull();
    for (const category of ["info", "notification", "spam"] as const) {
      expect(view.categories[category].history).toBeNull();
      expect(view.categories[category].evidence.blocks).not.toContain("history_fail");
      // A missing history result does not block (history only blocks).
      expect(view.categories[category].evidence.recommended).toBe(true);
    }
    expect(view.examples).toEqual({ info: [], notification: [], spam: [] });
  });

  test("the check block shows the newest check of any status: an open one has the items so far", async () => {
    const done = await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass" });
    const open = await db.transaction().execute((trx) =>
      insertCheckRow(trx, { orgId: box.org.orgId }, box.mailboxId, {
        status: "classifying",
        reason: "web",
        created_at: NOW,
      })
    );
    await addExample(db, box.org.orgId, box.mailboxId, open, { receivedAt: "2026-11-09T10:00:00Z" });
    await addExample(db, box.org.orgId, box.mailboxId, open, { receivedAt: "2026-11-08T10:00:00Z", actedOn: false });
    const view = await viewOf();
    expect(view.check).toEqual({
      status: "classifying",
      reason: "web",
      noResultReason: null,
      startedAt: NOW.toISOString(),
      finishedAt: null,
      checked: 2,
      capped: false,
    });
    // The history and the examples still come from the newest done check.
    expect(view.categories.info.history?.outcome).toBe("pass");
    expect(view.examples.info).toEqual([]);
    expect(done).not.toBe(open);
  });

  test("a trip shows its state; the category is not recommended, only eligible", async () => {
    await addTrip(db, box.org.orgId, box.mailboxId, "notification");
    const view = await viewOf();
    expect(view.categories.notification.trip).toMatchObject({ tripped: true, reason: "corrections" });
    expect(view.categories.notification.evidence).toEqual({ eligible: true, recommended: false, blocks: ["tripped"] });
    expect(view.categories.info.trip).toEqual({ tripped: false, reason: null, at: null });
  });

  test("global evidence and the real labels per category; a category with no gate file has no_global", async () => {
    const view = await viewOf("owner", gateOf(gateFile({ info: 0.8 })));
    expect(view.categories.info.global).toMatchObject({
      decision: "go",
      provisional: false,
      threshold: 0.8,
      cases: 200,
    });
    expect(view.categories.info.realLabels).toEqual({ kept: 0, precision: null, decision: "no-go: too few" });
    expect(view.categories.spam.global.decision).toBe("no-go");
    expect(view.categories.spam.evidence.blocks).toEqual(["global_no_go"]);
    const none = await viewOf("owner", gateOf(gateFile({ info: 0.8 }), { ...KEY, model: "other-model" }));
    expect(none.categories.info.global.decision).toBe("none");
    expect(none.categories.info.evidence.blocks).toEqual(["no_global"]);
  });

  test("auto is what triage reads: on under the running key, or with no grant; off under another key", async () => {
    const grant = (key: typeof KEY) => ({
      auto: true,
      threshold: 0.8,
      grant: { key, by: "evidence", at: "2026-11-01T10:00:00.000Z" },
    });
    await db
      .updateTable("mailbox_settings")
      .set({
        category_policy: JSON.stringify({
          info: grant(KEY),
          notification: grant({ ...KEY, model: "older-model" }),
          spam: { auto: true, threshold: 0.9 },
        }),
      })
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
    const { categories } = await viewOf();
    expect([categories.info.auto, categories.info.grantBy]).toEqual([true, "evidence"]);
    expect([categories.notification.auto, categories.notification.grantBy]).toEqual([false, null]);
    expect([categories.spam.auto, categories.spam.grantBy]).toEqual([true, null]);
  });

  test("a trip of another mailbox does not show here", async () => {
    await db
      .transaction()
      .execute((trx) => insertTripRow(trx, { orgId: box.org.otherOrgId }, box.otherMailboxId, { category: "info" }));
    expect((await viewOf()).categories.info.trip.tripped).toBe(false);
  });
});
