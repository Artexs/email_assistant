import { randomUUID } from "node:crypto";

import { textsFor, DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { undo } from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  listActivity,
  type ActivityCursor,
  type ActivityQuery,
} from "../../src/modules/reports";
import { setOrgFeature } from "../../src/modules/tenancy";
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
    createdAt: ago(HOUR_MS),
    receivedAt,
    messageId: `<m-${receivedAt.getTime()}-${randomUUID()}@ea-seed.test>`,
    reason: "Automated shipping update.",
  });
  // Distinct creation times keep the order of the actions fixed.
  await insertAction(trx, ctx, emailId, {
    type: "move",
    status: "applied",
    payload: { folder: "ai_notifications" },
    createdAt: ago(HOUR_MS),
  });
  await insertAction(trx, ctx, emailId, { type: "mark_read", status: "applied", createdAt: ago(HOUR_MS - 1000) });
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
      const { emailId } = await insertMoved(trx, ctxA, a.mailboxId, ago(HOUR_MS));
      const page = await listActivity(trx, ctxA, query, NOW, textsFor("en"));
      expect(page.nextBefore).toBeNull();
      expect(page.items).toHaveLength(1);
      const item = one(page.items);
      expect(item.emailId).toBe(emailId);
      expect(item.mailboxId).toBe(a.mailboxId);
      expect(item.category).toBe("notification");
      expect(item.phrase).toBe("done: move to AI/Notifications, mark read");
      expect(item.actions.map((x) => x.phrase)).toEqual(["done: move to AI/Notifications", "done: mark read"]);
      expect(item.actions.map((x) => x.appliedAt)).toEqual([
        ago(HOUR_MS).toISOString(),
        ago(HOUR_MS - 1000).toISOString(),
      ]);
      expect(item.undoable).toBe(true);
      expect(item.undoPending).toBe(false);
      expect(item.aiText).toBe("Automated shipping update.");
      expect(item.receivedAt).toBe(ago(HOUR_MS).toISOString());
      expect(item.feedback).toBeNull();
      expect(item.delegation).toBeNull();
    });
  });

  test("an undone mail: pending, then undone", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const { emailId } = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
        category: "notification",
        createdAt: ago(HOUR_MS),
        receivedAt: ago(HOUR_MS),
        messageId: "<undo-1@ea-seed.test>",
        actions: [
          { type: "move", status: "applied", payload: { folder: "ai_notifications" } },
          { type: "mark_read", status: "applied" },
        ],
      });
      const result = await undo(trx, ctxA, emailId, {
        now: NOW,
        userId: a.userId,
        scope: { kind: "synthetic", testMail: NO_TEST_SENDERS },
      });
      expect(result.kind).toBe("started");

      const pending = one((await listActivity(trx, ctxA, query, NOW, textsFor("en"))).items);
      expect(pending.undoable).toBe(false);
      expect(pending.undoPending).toBe(true);

      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: ago(10 * MINUTE_MS) })
        .where("org_id", "=", a.orgId)
        .where("reverses_action_id", "is not", null)
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "undone" })
        .where("org_id", "=", a.orgId)
        .where("reverses_action_id", "is", null)
        .execute();

      const done = one((await listActivity(trx, ctxA, query, NOW, textsFor("en"))).items);
      expect(done.phrase.startsWith("undone:")).toBe(true);
      expect(done.undoable).toBe(false);
      expect(done.undoPending).toBe(false);
    });
  });

  test("an approved send held by the send limit reads waiting only inside its window (D11 a)", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const cases: [string, string | null, Date | null, string][] = [
        ["held", "send_limit:mailbox_hour", new Date(NOW.getTime() + 10 * MINUTE_MS), "approved, waiting: send limit"],
        ["window over", "send_limit:mailbox_hour", new Date(NOW.getTime() - MINUTE_MS), "approved, sending"],
        ["no time", "send_limit:mailbox_hour", null, "approved, sending"],
        ["other error", "smtp_421", new Date(NOW.getTime() + 5 * MINUTE_MS), "approved, sending"],
      ];
      const expectedBy = new Map<string, string>();
      for (const [index, [, lastError, nextAttemptAt, phrase]] of cases.entries()) {
        const { emailId } = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
          category: "delegation",
          createdAt: ago(HOUR_MS),
          receivedAt: ago(index * MINUTE_MS + HOUR_MS),
          messageId: `<held-${index}-${randomUUID()}@ea-seed.test>`,
          reason: "Delegation.",
          actions: [{ type: "send", status: "approved", approvedAt: ago(2 * HOUR_MS), lastError, nextAttemptAt }],
        });
        expectedBy.set(emailId, phrase);
      }
      const page = await listActivity(trx, ctxA, query, NOW, textsFor("en"));
      for (const item of page.items) {
        const expected = expectedBy.get(item.emailId) ?? "missing";
        expect(item.actions.map((action) => action.phrase)).toEqual([expected]);
        expect(item.phrase).toBe(expected);
      }
      expect(page.items).toHaveLength(cases.length);
    });
  });

  test("ai text for info and unsure; no action means stays in the folder", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const info = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        receivedAt: ago(1 * HOUR_MS),
        reason: "Newsletter.",
        actions: [{ type: "save_summary", status: "applied", payload: { summary: "A short summary." } }],
      });
      const unsure = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "unsure",
        createdAt: ago(HOUR_MS),
        receivedAt: ago(2 * HOUR_MS),
        confidence: 0.45,
        reason: "Hard to tell.",
        fields: { model_category: "info" },
      });
      const page = await listActivity(trx, ctxA, query, NOW, textsFor("en"));
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
      const dueAt = new Date(NOW.getTime() + 2 * DAY_MS);
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctxA, a.mailboxId, {
        createdAt: ago(HOUR_MS),
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
      const item = one((await listActivity(trx, ctxA, query, NOW, textsFor("en"))).items);
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
      const emailId = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR_MS) });
      await insertFeedback(trx, ctxA, {
        emailId,
        verdict: "right",
        trueCategory: "info",
        source: "web",
        userId: a.userId,
      });
      const item = one((await listActivity(trx, ctxA, query, NOW, textsFor("en"))).items);
      expect(item.feedback?.verdict).toBe("right");
      expect(item.feedback?.trueCategory).toBe("info");
      expect(item.feedback?.source).toBe("web");
    });
  });

  test("pages by the cursor with equal timestamps", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const same = ago(2 * HOUR_MS);
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        created.push(
          await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR_MS), receivedAt: same })
        );
      }
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: ActivityCursor | undefined;
      let last: string | null = null;
      for (let i = 0; i < 5; i += 1) {
        const page = await listActivity(trx, ctxA, { ...query, limit: 2, cursor }, NOW, textsFor("en"));
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
        createdAt: ago(100 * DAY_MS),
        receivedAt: ago(100 * DAY_MS),
      });
      const mid = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(80 * DAY_MS),
        receivedAt: ago(80 * DAY_MS),
      });
      const fresh = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(DAY_MS),
        receivedAt: ago(DAY_MS),
      });
      const clamped = await listActivity(trx, ctxA, { ...query, since: ago(120 * DAY_MS) }, NOW, textsFor("en"));
      expect(clamped.items.map((item) => item.emailId)).toEqual([fresh, mid]);
      expect(clamped.items.map((item) => item.emailId)).not.toContain(old);
      const def = await listActivity(trx, ctxA, query, NOW, textsFor("en"));
      expect(def.items.map((item) => item.emailId)).toEqual([fresh]);
    });
  });

  test("filters by organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const mine = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR_MS) });
      await insertTriaged(trx, ctxB, b.mailboxId, { category: "info", createdAt: ago(HOUR_MS) });
      const page = await listActivity(trx, ctxA, query, NOW, textsFor("en"));
      expect(page.items.map((item) => item.emailId)).toEqual([mine]);
      expect((await listActivity(trx, ctxA, { ...query, mailboxId: b.mailboxId }, NOW, textsFor("en"))).items).toEqual(
        []
      );
    });
  });

  test("runs a fixed number of queries per page", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const delegateId = await insertDelegate(trx, ctxA, { name: "Ola" });

      async function addTriple(n: number): Promise<void> {
        const at = ago(HOUR_MS + n * MINUTE_MS);
        await insertMoved(trx, ctxA, a.mailboxId, at);
        await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
          category: "info",
          createdAt: ago(HOUR_MS),
          receivedAt: ago(HOUR_MS + n * MINUTE_MS + 30_000),
          actions: [{ type: "save_summary", status: "applied", payload: { summary: `Summary ${n}` } }],
        });
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctxA, a.mailboxId, {
          createdAt: ago(HOUR_MS),
          delegateId,
          delegateName: "Ola",
          task: `Task ${n}`,
        });
        await trx
          .updateTable("emails")
          .set({ received_at: ago(HOUR_MS + n * MINUTE_MS + 45_000) })
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

      // The flag on is the longest path: the flag read and the reasons query; the flag read of `reply_drafts` (off here) is one more.
      await setOrgFeature(trx, ctxA, { flag: "suspicious_mail", enabled: true, actor: "cli", now: NOW });
      await addTriple(0);
      const small = countingPlugin();
      const page3 = await listActivity(
        trx.withPlugin(small.plugin),
        ctxA,
        { ...query, limit: 100 },
        NOW,
        textsFor("en")
      );
      expect(page3.items).toHaveLength(3);
      expect(small.counter.count).toBeLessThanOrEqual(10);

      for (let n = 1; n < 20; n += 1) await addTriple(n);
      const large = countingPlugin();
      const page60 = await listActivity(
        trx.withPlugin(large.plugin),
        ctxA,
        { ...query, limit: 100 },
        NOW,
        textsFor("en")
      );
      expect(page60.items).toHaveLength(60);
      expect(large.counter.count).toBe(small.counter.count);
    });
  });

  test("the open reply drafts of a page take ONE query, whatever the number of rows; the flag off reads none", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const countFor = async () => {
        const { counter, plugin } = countingPlugin();
        const page = await listActivity(trx.withPlugin(plugin), ctxA, { ...query, limit: 100 }, NOW, textsFor("en"));
        return { count: counter.count, page };
      };
      for (let n = 0; n < 2; n += 1) {
        await insertTriaged(trx, ctxA, a.mailboxId, {
          category: "needs_reply",
          createdAt: ago(HOUR_MS),
          receivedAt: ago(HOUR_MS + n * MINUTE_MS),
        });
      }
      const off = await countFor();
      expect(off.page.items.every((item) => item.reply === undefined)).toBe(true);

      await setOrgFeature(trx, ctxA, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
      const small = await countFor();
      expect(small.page.items.every((item) => item.reply?.sendId === null)).toBe(true);
      // The flag read is in both runs; the flag on adds the one read of the open drafts.
      expect(small.count).toBe(off.count + 1);

      for (let n = 2; n < 20; n += 1) {
        await insertTriaged(trx, ctxA, a.mailboxId, {
          category: "needs_reply",
          createdAt: ago(HOUR_MS),
          receivedAt: ago(HOUR_MS + n * MINUTE_MS),
        });
      }
      const large = await countFor();
      expect(large.page.items).toHaveLength(20);
      expect(large.count).toBe(small.count);
    });
  });

  test("an empty result takes one query", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA } = await setup(trx);
      const { counter, plugin } = countingPlugin();
      const page = await listActivity(trx.withPlugin(plugin), ctxA, query, NOW, textsFor("en"));
      expect(page).toEqual({ items: [], nextBefore: null });
      expect(counter.count).toBe(1);
    });
  });
});

describe("listActivity: suspicious", () => {
  test("the codes of the newest result with the flag on, [] with it off, nothing of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const flagged = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["lookalike_domain", "link_mismatch"],
      });
      const clean = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        receivedAt: ago(2 * HOUR_MS),
      });
      // B holds a flagged mail; A holds none besides its own.
      await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      const byId = async (ctx: TenantContext) =>
        new Map((await listActivity(trx, ctx, query, NOW, textsFor("en"))).items.map((i) => [i.emailId, i.suspicious]));

      const off = await byId(ctxA);
      expect(off.get(flagged)).toEqual([]);
      expect(off.get(clean)).toEqual([]);

      await setOrgFeature(trx, ctxA, { flag: "suspicious_mail", enabled: true, actor: "cli", now: NOW });
      const on = await byId(ctxA);
      expect(on.get(flagged)).toEqual(["lookalike_domain", "link_mismatch"]);
      expect(on.get(clean)).toEqual([]);
      expect(on.size).toBe(2);

      // The flag is per organization: B has it off.
      const forB = [...(await byId(ctxB)).values()];
      expect(forB).toEqual([[]]);
      await setOrgFeature(trx, ctxB, { flag: "suspicious_mail", enabled: true, actor: "cli", now: NOW });
      expect([...(await byId(ctxB)).values()]).toEqual([["auth_fail"]]);
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
    expect(decodeActivityCursor(b64(`0000-01-01T00:00:00.000000Z|${cursor.id}`))).toBeNull();
  });
});

describe("activity rule hit (F110 stage 16)", () => {
  test("the rule shows only while why_lines is on; an old row and another organization read null", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const vip = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "needs_reply",
        createdAt: ago(HOUR_MS),
        fields: { rule: "vip" },
      });
      const black = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "spam",
        createdAt: ago(2 * HOUR_MS),
        reasonCode: "blocklist",
        fields: { rule: "blocklist" },
      });
      const white = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
        fields: { rule: "whitelist" },
      });
      const old = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(4 * HOUR_MS) });
      // A value that is no rule reads null.
      const junk = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(5 * HOUR_MS),
        fields: { rule: "somebody@example.com" },
      });
      await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        fields: { rule: "vip" },
      });
      const byId = async (ctx: TenantContext) =>
        new Map((await listActivity(trx, ctx, query, NOW, textsFor("en"))).items.map((i) => [i.emailId, i.rule]));

      const off = await byId(ctxA);
      expect([...off.values()]).toEqual([null, null, null, null, null]);

      await setOrgFeature(trx, ctxA, { flag: "why_lines", enabled: true, actor: "cli", now: NOW });
      const on = await byId(ctxA);
      expect(on.get(vip)).toBe("vip");
      expect(on.get(black)).toBe("blocklist");
      expect(on.get(white)).toBe("whitelist");
      expect(on.get(old)).toBeNull();
      expect(on.get(junk)).toBeNull();

      // The flag is per organization: B has it off.
      expect([...(await byId(ctxB)).values()]).toEqual([null]);
    });
  });
});
