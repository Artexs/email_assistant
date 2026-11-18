import {
  trustHistoryCheckAnswerSchema,
  trustRecommendedAnswerSchema,
  type TrustHistoryCheckAnswer,
  type TrustRecommendedAnswer,
} from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";

import { testDb } from "./helpers";
import { as } from "./web-helpers";
import {
  addDoneCheck,
  addTrip,
  auditOf,
  gateFile,
  gateOf,
  KEY,
  NOW,
  newId,
  policyOf,
  trustWebBox,
  type TrustWebBox,
} from "./web-trust-kit";

// POST /api/trust/:mailboxId/recommended and /history-check. Committed rows; `afterEach` removes the organizations.
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

const post = (path: string, cookie: string, mailboxId = box.mailboxId, gate?: ReturnType<typeof gateOf>) =>
  box.app(gate).request(`/api/trust/${mailboxId}/${path}`, as(cookie, { method: "POST" }));

const recommend = (cookie = "owner", gate?: ReturnType<typeof gateOf>) =>
  post("recommended", cookie, box.mailboxId, gate);

async function answerOf(res: Response): Promise<TrustRecommendedAnswer> {
  expect(res.status).toBe(200);
  return trustRecommendedAnswerSchema.parse(await res.json());
}

// The state that a refused call must leave as it was.
const stateOf = async (mailboxId = box.mailboxId, orgId = box.org.orgId) => ({
  settings: await policyOf(db, mailboxId),
  audit: await auditOf(db, orgId),
});

const checksOf = (mailboxId: string) =>
  db.selectFrom("history_checks").select(["status", "reason"]).where("mailbox_id", "=", mailboxId).execute();

describe("POST /api/trust/:mailboxId/recommended", () => {
  test("5: a shadow mailbox with info and notification recommended and spam blocked: assist, two grants, audit rows with via web", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "inconclusive", spam: "fail" });
    const answer = await answerOf(await recommend());
    expect(answer.turnedOn).toEqual(["info", "notification"]);
    expect(answer.mode).toBe("assist");
    expect(answer.view.mode).toBe("assist");
    expect(answer.view.categories.info).toMatchObject({ auto: true, grantBy: "recommended" });
    expect(answer.view.categories.notification).toMatchObject({ auto: true, grantBy: "recommended" });
    expect(answer.view.categories.spam).toMatchObject({ auto: false, grantBy: null });

    const { mode, switches, policy } = await policyOf(db, box.mailboxId);
    expect(mode).toBe("assist");
    expect(switches).toMatchObject({ move: true, mark_read: true, flag: true, move_unsure: false });
    // The threshold is the one of the gate file; the grant carries the running key.
    expect(policy.info).toMatchObject({ auto: true, threshold: 0.8, grant: { by: "recommended", key: KEY } });
    expect(policy.notification).toMatchObject({ auto: true, threshold: 0.9, grant: { by: "recommended" } });
    expect(policy.spam).toBeUndefined();

    const audit = await auditOf(db, box.org.orgId);
    expect(audit.map((row) => [row.event, (row.data as Record<string, unknown>).field])).toEqual([
      ["mailbox.mode_changed", "mode"],
      ["mailbox.policy_changed", "auto.info"],
      ["mailbox.policy_changed", "auto.notification"],
    ]);
    for (const row of audit) expect(row.data).toMatchObject({ via: "web", mailbox_id: box.mailboxId });
    expect(audit[1]?.data).toMatchObject({ grant_by: "recommended", forced: false, to: true });
  });

  test("6: nothing recommended is a 409 and changes nothing: the mode stays shadow, no audit row", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "fail", notification: "fail", spam: "fail" });
    const before = await stateOf();
    const res = await recommend();
    expect([res.status, await res.json()]).toEqual([409, { error: "nothing_recommended" }]);
    expect(await stateOf()).toEqual(before);
    expect(before.settings.mode).toBe("shadow");
    expect(before.audit).toEqual([]);
  });

  test("6: no global evidence for the running key is nothing recommended too", async () => {
    const res = await recommend("owner", gateOf(gateFile({ info: 0.8 }), { ...KEY, model: "other-model" }));
    expect([res.status, await res.json()]).toEqual([409, { error: "nothing_recommended" }]);
    expect((await policyOf(db, box.mailboxId)).mode).toBe("shadow");
  });

  test("a tripped category is never turned on and its trip stays; the others are", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "pass", spam: "pass" });
    await addTrip(db, box.org.orgId, box.mailboxId, "notification");
    const answer = await answerOf(await recommend());
    expect(answer.turnedOn).toEqual(["info", "spam"]);
    expect((await policyOf(db, box.mailboxId)).policy.notification).toBeUndefined();
    const trips = await db
      .selectFrom("autonomy_trips")
      .select("cleared_at")
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
    expect(trips.map((trip) => trip.cleared_at)).toEqual([null]);
    expect(answer.view.categories.notification.trip.tripped).toBe(true);
  });

  test("a mailbox that is in assist keeps its switches; a category that is on is not granted again", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "fail", spam: "fail" });
    await db
      .updateTable("mailbox_settings")
      .set({
        mode: "assist",
        tool_switches: JSON.stringify({
          move: true,
          mark_read: false,
          flag: false,
          create_draft: false,
          move_unsure: false,
        }),
        category_policy: JSON.stringify({
          info: { auto: true, threshold: 0.7, grant: { key: KEY, by: "forced", at: "2026-11-01T10:00:00.000Z" } },
        }),
      })
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
    const before = await stateOf();
    const res = await recommend();
    // Info is on already, the others fail: nothing to turn on, and the forced grant stays forced.
    expect([res.status, await res.json()]).toEqual([409, { error: "nothing_recommended" }]);
    expect(await stateOf()).toEqual(before);
    expect(before.settings.policy.info?.grant?.by).toBe("forced");
  });

  test("in assist the mode and the switches are not touched while a category is turned on", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "fail", spam: "fail" });
    const switches = { move: true, mark_read: false, flag: false, create_draft: false, move_unsure: false };
    await db
      .updateTable("mailbox_settings")
      .set({ mode: "assist", tool_switches: JSON.stringify(switches) })
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
    const answer = await answerOf(await recommend());
    expect(answer.turnedOn).toEqual(["info"]);
    expect((await policyOf(db, box.mailboxId)).switches).toMatchObject(switches);
    expect((await auditOf(db, box.org.orgId)).map((row) => row.event)).toEqual(["mailbox.policy_changed"]);
  });

  test("a category that is on under an older model setup is turned on again under the running key", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "fail", spam: "fail" });
    await db
      .updateTable("mailbox_settings")
      .set({
        mode: "assist",
        category_policy: JSON.stringify({
          info: {
            auto: true,
            threshold: 0.8,
            grant: { key: { ...KEY, model: "older-model" }, by: "evidence", at: "2026-11-01T10:00:00.000Z" },
          },
        }),
      })
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
    const answer = await answerOf(await recommend());
    expect(answer.turnedOn).toEqual(["info"]);
    expect((await policyOf(db, box.mailboxId)).policy.info?.grant).toMatchObject({ by: "recommended", key: KEY });
  });

  test("8: a second tap turns on nothing new: 409 and no second audit row", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "pass", spam: "fail" });
    await answerOf(await recommend());
    const after = await stateOf();
    expect(after.audit).toHaveLength(3);
    const res = await recommend();
    expect([res.status, await res.json()]).toEqual([409, { error: "nothing_recommended" }]);
    expect(await stateOf()).toEqual(after);
  });

  test("7: a member gets 403 owner_only, also with a bad id, and nothing changes", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass" });
    const before = await stateOf();
    for (const id of [box.mailboxId, "not-a-uuid"]) {
      const res = await post("recommended", "member", id);
      expect([res.status, await res.json()]).toEqual([403, { error: "owner_only" }]);
    }
    expect(await stateOf()).toEqual(before);
  });

  test("a mailbox of another organization and an unknown id are the same 404; nothing is written for the other organization", async () => {
    await addDoneCheck(db, box.org.otherOrgId, box.otherMailboxId, { info: "pass" });
    const before = await stateOf(box.otherMailboxId, box.org.otherOrgId);
    const answers = [];
    for (const id of [box.otherMailboxId, newId(), "not-a-uuid"]) {
      const res = await post("recommended", "owner", id);
      answers.push([res.status, await res.json()]);
    }
    expect(answers).toEqual(Array(3).fill([404, { error: "not_found" }]));
    expect(await stateOf(box.otherMailboxId, box.org.otherOrgId)).toEqual(before);
  });

  test("the flag off is 404, also for a member, and nothing changes", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass" });
    await upsertOrgFeature(
      db,
      { orgId: box.org.orgId },
      { flag: "trust_ladder", enabled: false, setBy: "test", setAt: NOW }
    );
    const before = await stateOf();
    for (const cookie of ["owner", "member"]) {
      const res = await recommend(cookie);
      expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    }
    expect(await stateOf()).toEqual(before);
  });
});

describe("POST /api/trust/:mailboxId/history-check", () => {
  test("9: the owner queues a check with the reason web (202); a second call while it is open is 409 check_running", async () => {
    const res = await post("history-check", "owner");
    expect(res.status).toBe(202);
    const answer: TrustHistoryCheckAnswer = trustHistoryCheckAnswerSchema.parse(await res.json());
    expect(answer.check).toMatchObject({
      status: "queued",
      reason: "web",
      noResultReason: null,
      finishedAt: null,
      checked: 0,
      capped: false,
    });
    expect(await checksOf(box.mailboxId)).toEqual([{ status: "queued", reason: "web" }]);

    const again = await post("history-check", "owner");
    expect([again.status, await again.json()]).toEqual([409, { error: "check_running" }]);
    expect(await checksOf(box.mailboxId)).toHaveLength(1);
  });

  test("9: a check that ended does not block a new one", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass" });
    expect((await post("history-check", "owner")).status).toBe(202);
    expect(await checksOf(box.mailboxId)).toHaveLength(2);
  });

  test("7: a member gets 403 and no check is queued", async () => {
    const res = await post("history-check", "member");
    expect([res.status, await res.json()]).toEqual([403, { error: "owner_only" }]);
    expect(await checksOf(box.mailboxId)).toEqual([]);
  });

  test("a mailbox of another organization and an unknown id are the same 404 and queue nothing", async () => {
    const answers = [];
    for (const id of [box.otherMailboxId, newId(), "not-a-uuid"]) {
      const res = await post("history-check", "owner", id);
      answers.push([res.status, await res.json()]);
    }
    expect(answers).toEqual(Array(3).fill([404, { error: "not_found" }]));
    expect(await checksOf(box.otherMailboxId)).toEqual([]);
  });

  test("the flag off is 404 and queues nothing", async () => {
    await upsertOrgFeature(
      db,
      { orgId: box.org.orgId },
      { flag: "trust_ladder", enabled: false, setBy: "test", setAt: NOW }
    );
    for (const cookie of ["owner", "member"]) {
      const res = await post("history-check", cookie);
      expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    }
    expect(await checksOf(box.mailboxId)).toEqual([]);
  });
});
