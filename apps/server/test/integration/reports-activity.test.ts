import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { undo } from "../../src/modules/actions";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  listActivity,
  type ActivityCursor,
  type ActivityQuery,
} from "../../src/modules/reports";
import { insertFeedback } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-11T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const query: ActivityQuery = { notRated: false };

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, b, ctxA: { orgId: a.orgId }, ctxB: { orgId: b.orgId } };
}

function one<T>(list: readonly (T | undefined)[]): T {
  const [first] = list;
  if (first === undefined) throw new Error("no item");
  return first;
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

async function insertMoved(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, receivedAt: Date) {
  const emailId = await insertTriaged(trx, ctx, mailboxId, {
    category: "notification",
    createdAt: ago(HOUR),
    receivedAt,
    messageId: `<m-${receivedAt.getTime()}-${randomUUID()}@ea-seed.test>`,
    reason: "Automated shipping update.",
  });
  // Distinct creation times keep the order of the actions fixed.
  await insertAction(trx, ctx, emailId, {
    type: "move",
    status: "applied",
    payload: { folder: "ai_notifications" },
    createdAt: ago(HOUR),
  });
  await insertAction(trx, ctx, emailId, { type: "mark_read", status: "applied", createdAt: ago(HOUR - 1000) });
  return { emailId };
}

// Counts every query that goes through the executor (builder and raw `sql`).
function countingPlugin() {
  const counter = { count: 0 };
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      counter.count += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { counter, plugin };
}

describe("listActivity", () => {
  test("describes a moved mail: phrase, actions, undoable", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const { emailId } = await insertMoved(trx, ctxA, a.mailboxId, ago(HOUR));
      const page = await listActivity(trx, ctxA, query, NOW);
      expect(page.nextBefore).toBeNull();
      expect(page.items).toHaveLength(1);
      const item = one(page.items);
      expect(item.emailId).toBe(emailId);
      expect(item.mailboxId).toBe(a.mailboxId);
      expect(item.category).toBe("notification");
      expect(item.phrase).toBe("done: move to AI/Notifications, mark read");
      expect(item.actions.map((x) => x.phrase)).toEqual(["done: move to AI/Notifications", "done: mark read"]);
      expect(item.actions.map((x) => x.appliedAt)).toEqual([ago(HOUR).toISOString(), ago(HOUR - 1000).toISOString()]);
      expect(item.undoable).toBe(true);
      expect(item.undoPending).toBe(false);
      expect(item.aiText).toBe("Automated shipping update.");
      expect(item.receivedAt).toBe(ago(HOUR).toISOString());
      expect(item.feedback).toBeNull();
      expect(item.delegation).toBeNull();
    });
  });

  test("an undone mail: pending, then undone", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const { emailId } = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
        category: "notification",
        createdAt: ago(HOUR),
        receivedAt: ago(HOUR),
        messageId: "<undo-1@ea-seed.test>",
        actions: [
          { type: "move", status: "applied", payload: { folder: "ai_notifications" } },
          { type: "mark_read", status: "applied" },
        ],
      });
      const result = await undo(trx, ctxA, emailId, { now: NOW, userId: a.userId, scope: { kind: "synthetic" } });
      expect(result.kind).toBe("started");

      const pending = one((await listActivity(trx, ctxA, query, NOW)).items);
      expect(pending.undoable).toBe(false);
      expect(pending.undoPending).toBe(true);

      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: ago(10 * MINUTE) })
        .where("org_id", "=", a.orgId)
        .where("reverses_action_id", "is not", null)
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "undone" })
        .where("org_id", "=", a.orgId)
        .where("reverses_action_id", "is", null)
        .execute();

      const done = one((await listActivity(trx, ctxA, query, NOW)).items);
      expect(done.phrase.startsWith("undone:")).toBe(true);
      expect(done.undoable).toBe(false);
      expect(done.undoPending).toBe(false);
    });
  });

  test("ai text for info and unsure; no action means stays in the folder", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const info = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        receivedAt: ago(1 * HOUR),
        reason: "Newsletter.",
        actions: [{ type: "save_summary", status: "applied", payload: { summary: "A short summary." } }],
      });
      const unsure = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "unsure",
        createdAt: ago(HOUR),
        receivedAt: ago(2 * HOUR),
        confidence: 0.45,
        reason: "Hard to tell.",
        fields: { model_category: "info" },
      });
      const page = await listActivity(trx, ctxA, query, NOW);
      const byId = new Map(page.items.map((item) => [item.emailId, item]));
      expect(byId.get(info.emailId)?.aiText).toBe("A short summary.");
      const u = one([byId.get(unsure)]);
      expect(u.aiText).toBe("Hard to tell. (AI guess: Info, 45%)");
      expect(u.phrase).toBe("stays in INBOX");
      expect(u.actions).toEqual([]);
      expect(u.undoable).toBe(false);
      expect(u.modelCategory).toBe("info");
    });
  });

  test("a delegation mail shows the task, the phrase and the delegation", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const delegateId = await insertDelegate(trx, ctxA, { name: "Ola" });
      const dueAt = new Date(NOW.getTime() + 2 * DAY);
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctxA, a.mailboxId, {
        createdAt: ago(HOUR),
        delegateId,
        delegateName: "Ola",
        task: "Send the Q4 report",
      });
      await insertDelegation(trx, ctxA, {
        mailboxId: a.mailboxId,
        emailId,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        status: "drafted",
        dueAt,
      });
      const item = one((await listActivity(trx, ctxA, query, NOW)).items);
      expect(item.emailId).toBe(emailId);
      expect(item.aiText).toBe("Send the Q4 report");
      expect(item.phrase).toContain("draft a delegation to Ola");
      expect(item.phrase).toContain("waits for your approval");
      expect(item.delegation).toEqual({ delegateName: "Ola", status: "drafted", dueAt: dueAt.toISOString() });
    });
  });

  test("shows the latest feedback", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const emailId = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR) });
      await insertFeedback(trx, ctxA, {
        emailId,
        verdict: "right",
        trueCategory: "info",
        source: "web",
        userId: a.userId,
      });
      const item = one((await listActivity(trx, ctxA, query, NOW)).items);
      expect(item.feedback?.verdict).toBe("right");
      expect(item.feedback?.trueCategory).toBe("info");
      expect(item.feedback?.source).toBe("web");
    });
  });

  test("pages by the cursor with equal timestamps", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const same = ago(2 * HOUR);
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        created.push(
          await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR), receivedAt: same })
        );
      }
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: ActivityCursor | undefined;
      let last: string | null = null;
      for (let i = 0; i < 5; i += 1) {
        const page = await listActivity(trx, ctxA, { ...query, limit: 2, cursor }, NOW);
        sizes.push(page.items.length);
        seen.push(...page.items.map((item) => item.emailId));
        last = page.nextBefore;
        if (last === null) break;
        const decoded = decodeActivityCursor(last);
        expect(decoded).not.toBeNull();
        if (decoded === null) throw new Error("bad cursor");
        cursor = decoded;
      }
      expect(sizes).toEqual([2, 2, 1]);
      expect(last).toBeNull();
      expect(new Set(seen).size).toBe(5);
      expect([...seen].sort()).toEqual([...created].sort());
    });
  });

  test("the window: the 90-day clamp and the 7-day default", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const old = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(100 * DAY),
        receivedAt: ago(100 * DAY),
      });
      const mid = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(80 * DAY),
        receivedAt: ago(80 * DAY),
      });
      const fresh = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(DAY),
        receivedAt: ago(DAY),
      });
      const clamped = await listActivity(trx, ctxA, { ...query, since: ago(120 * DAY) }, NOW);
      expect(clamped.items.map((item) => item.emailId)).toEqual([fresh, mid]);
      expect(clamped.items.map((item) => item.emailId)).not.toContain(old);
      const def = await listActivity(trx, ctxA, query, NOW);
      expect(def.items.map((item) => item.emailId)).toEqual([fresh]);
    });
  });

  test("filters by organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const mine = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR) });
      await insertTriaged(trx, ctxB, b.mailboxId, { category: "info", createdAt: ago(HOUR) });
      const page = await listActivity(trx, ctxA, query, NOW);
      expect(page.items.map((item) => item.emailId)).toEqual([mine]);
      expect((await listActivity(trx, ctxA, { ...query, mailboxId: b.mailboxId }, NOW)).items).toEqual([]);
    });
  });

  test("runs a fixed number of queries per page", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const delegateId = await insertDelegate(trx, ctxA, { name: "Ola" });

      async function addTriple(n: number): Promise<void> {
        const at = ago(HOUR + n * MINUTE);
        await insertMoved(trx, ctxA, a.mailboxId, at);
        await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
          category: "info",
          createdAt: ago(HOUR),
          receivedAt: ago(HOUR + n * MINUTE + 30_000),
          actions: [{ type: "save_summary", status: "applied", payload: { summary: `Summary ${n}` } }],
        });
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctxA, a.mailboxId, {
          createdAt: ago(HOUR),
          delegateId,
          delegateName: "Ola",
          task: `Task ${n}`,
        });
        await trx
          .updateTable("emails")
          .set({ received_at: ago(HOUR + n * MINUTE + 45_000) })
          .where("id", "=", emailId)
          .execute();
        await insertDelegation(trx, ctxA, {
          mailboxId: a.mailboxId,
          emailId,
          delegateId,
          draftActionId: draftId,
          sendActionId: sendId,
        });
      }

      await addTriple(0);
      const small = countingPlugin();
      const page3 = await listActivity(trx.withPlugin(small.plugin), ctxA, { ...query, limit: 100 }, NOW);
      expect(page3.items).toHaveLength(3);
      expect(small.counter.count).toBeLessThanOrEqual(7);

      for (let n = 1; n < 20; n += 1) await addTriple(n);
      const large = countingPlugin();
      const page60 = await listActivity(trx.withPlugin(large.plugin), ctxA, { ...query, limit: 100 }, NOW);
      expect(page60.items).toHaveLength(60);
      expect(large.counter.count).toBe(small.counter.count);
    });
  });

  test("an empty result takes one query", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA } = await setup(trx);
      const { counter, plugin } = countingPlugin();
      const page = await listActivity(trx.withPlugin(plugin), ctxA, query, NOW);
      expect(page).toEqual({ items: [], nextBefore: null });
      expect(counter.count).toBe(1);
    });
  });
});

describe("activity cursor", () => {
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
  const cursor: ActivityCursor = {
    receivedAtKey: "2026-11-11T10:00:00.123456Z",
    id: "6f1c1f0e-3c5e-4a53-9d6f-2d6d6b0a9e11",
  };

  test("round-trips", () => {
    expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
  });

  test("refuses bad text", () => {
    expect(decodeActivityCursor("x")).toBeNull();
    expect(decodeActivityCursor("%%%")).toBeNull();
    expect(decodeActivityCursor(b64("a|b"))).toBeNull();
    expect(decodeActivityCursor(b64("2026-11-11T10:00:00.000000Z|not-a-uuid"))).toBeNull();
    expect(decodeActivityCursor(b64(`${cursor.receivedAtKey}|${cursor.id}|x`))).toBeNull();
    expect(decodeActivityCursor(b64(`2026-13-45T10:00:00.000000Z|${cursor.id}`))).toBeNull();
    expect(decodeActivityCursor(b64(`2026-02-30T10:00:00.000000Z|${cursor.id}`))).toBeNull();
    expect(decodeActivityCursor(b64(`2026-02-29T10:00:00.000000Z|${cursor.id}`))).toBeNull();
  });
});
