import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { countLlmCallsSince, recordLlmCall } from "../../src/modules/audit";
import { LlmBlockedError } from "../../src/platform/llm";

import { linkChat, randomChatId } from "./fixtures";
import { testDb } from "./helpers";
import {
  checkOf,
  expectFinishedTogether,
  fakeLlm,
  itemsOf,
  llmCallRows,
  MODEL,
  priceFixture,
  RUN_MS,
  seedClassifying,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { advance, jobOf, RUNNING_KEY } from "./trust-history-helpers";

// The classify step. The box holds a check in `classifying` and mail rows that the test places; the model is
// a fake with a fixed price (one cent per 10,000 tokens). The backfill and the flags steps are tested in
// trust-history-job-backfill.test.ts and trust-history-job-flags.test.ts.

const db = testDb();
let removePrice: () => void;

beforeAll(() => {
  removePrice = priceFixture();
});

afterAll(async () => {
  removePrice();
  await db.destroy();
});

describe("3. the cost cap", () => {
  test("one cent per call stops at 25 calls: capped, cost 0.25, the check is done", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(
        db,
        box,
        Array.from({ length: 60 }, () => ({}))
      );
      const llm = fakeLlm(box);
      const job = jobOf(db, box, { llm });
      for (let run = 0; run < 6 && (await checkOf(db, checkId)).status === "classifying"; run += 1) {
        await job.run();
        advance(box, RUN_MS);
      }
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "done", capped: true });
      expect(Number(check.cost_usd)).toBe(0.25);
      expect(llm.calls).toHaveLength(25);
      expect(await itemsOf(db, checkId)).toHaveLength(25);
      expectFinishedTogether(check);
    });
  });
});

describe("4. a crash after a call and before its commit", () => {
  test("the repeat calls the model once more for that mail and keeps one item row", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const [id] = await seedMails(db, box, [{}]);
      const llm = fakeLlm(box);
      await jobOf(db, box, {
        llm,
        hooks: {
          afterCall: () => {
            throw new Error("crash after the call");
          },
        },
      }).run();
      expect(llm.calls).toHaveLength(1);
      expect(await itemsOf(db, checkId)).toHaveLength(0);
      expect(await checkOf(db, checkId)).toMatchObject({ status: "classifying", attempts: 1, locked_at: null });

      advance(box, 6 * MINUTE_MS);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(2);
      const items = await itemsOf(db, checkId);
      expect(items.map((item) => item.email_id)).toEqual([id as string]);
      // Two calls are two `llm.call` rows (the spend is real), one item.
      expect(await llmCallRows(db, box.orgId)).toHaveLength(2);
      expect(await checkOf(db, checkId)).toMatchObject({ status: "done" });
    });
  });
});

describe("5. a model without a price", () => {
  test("the check ends no_result / cost_unknown before any call", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const unpriced = { ...RUNNING_KEY, model: "model-with-no-price" };
      await db
        .updateTable("history_checks")
        .set({ key: JSON.stringify(unpriced) })
        .where("id", "=", checkId)
        .execute();
      await seedMails(db, box, [{}, {}]);
      const llm = fakeLlm(box, { model: unpriced.model });
      await jobOf(db, box, { llm, runningKey: unpriced }).run();
      expect(llm.calls).toHaveLength(0);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "cost_unknown", locked_at: null });
      expectFinishedTogether(check);
      expect(await itemsOf(db, checkId)).toHaveLength(0);
    });
  });
});

describe("6. the daily cap leaves the history calls out", () => {
  test("300 normal llm.call rows and 50 history rows today: the count is 300, with and without a role", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const at = box.clock.now;
      const call = {
        mailboxId: box.mailboxId,
        role: "classifier" as const,
        promptVersion: "classifier-v2",
        model: MODEL,
      };
      const base = {
        ...call,
        endpoint: "standard" as const,
        provider: "openai" as const,
        outcome: "ok",
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: 1,
        at,
      };
      for (let n = 0; n < 300; n += 1) await recordLlmCall(db, box, base);
      for (let n = 0; n < 50; n += 1) await recordLlmCall(db, box, { ...base, historyCheckId: checkId });
      const since = new Date(at.getTime() - HOUR_MS);
      expect(await countLlmCallsSince(db, box, box.mailboxId, since)).toBe(300);
      expect(await countLlmCallsSince(db, box, box.mailboxId, since, { role: "classifier" })).toBe(300);
      // The rows are there for the cost reports (M7 counts the real spend).
      expect(await llmCallRows(db, box.orgId)).toHaveLength(350);
    });
  });

  test("every call of the step writes a row with the check id, the mailbox id and the mail id, also a failed call", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const ids = await seedMails(db, box, [{}, {}]);
      const llm = fakeLlm(box, { fail: (n) => (n === 2 ? new LlmBlockedError(MODEL) : undefined) });
      await jobOf(db, box, { llm }).run();
      const rows = await llmCallRows(db, box.orgId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.data).toMatchObject({ historyCheckId: checkId, mailbox_id: box.mailboxId, role: "classifier" });
        expect(ids).toContain(row.email_id as string);
      }
      expect(rows.map((row) => row.reason_code).sort()).toEqual(["llm_blocked", "ok"]);
    });
  });
});

describe("7. a model switch during the check", () => {
  test("the next run ends the check no_result / key_changed and queues a model_switch check; no notice", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(
        db,
        box,
        Array.from({ length: 30 }, () => ({}))
      );
      await jobOf(db, box, { llm: fakeLlm(box) }).run();
      expect(await itemsOf(db, checkId)).toHaveLength(20);
      advance(box, RUN_MS);
      const switched = { ...RUNNING_KEY, model: "another-model" };
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm, runningKey: switched }).run();
      expect(llm.calls).toHaveLength(0);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "key_changed", locked_at: null });
      expectFinishedTogether(check);
      const rows = await db
        .selectFrom("history_checks")
        .select(["id", "status", "reason"])
        .where("mailbox_id", "=", box.mailboxId)
        .execute();
      expect(rows.filter((row) => row.id !== checkId)).toMatchObject([{ status: "queued", reason: "model_switch" }]);
      expect(await db.selectFrom("outbox").select("id").where("org_id", "=", box.orgId).execute()).toEqual([]);
    });
  });

  test("a check with no stored key counts as another key", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db.updateTable("history_checks").set({ key: null }).where("id", "=", checkId).execute();
      await seedMails(db, box, [{}]);
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(0);
      expect(await checkOf(db, checkId)).toMatchObject({ status: "no_result", no_result_reason: "key_changed" });
    });
  });
});

describe("8. timing", () => {
  test("500 window mails, none triaged, 0.1 s per call, a run every 15 s: done before connect + 60 min", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const connect = box.clock.now.getTime();
      await seedMails(
        db,
        box,
        Array.from({ length: 500 }, () => ({}))
      );
      // 100 tokens per call: 500 calls cost 5 cents, under the cap.
      const llm = fakeLlm(box, { delayMs: 100, tokens: 100 });
      const job = jobOf(db, box, { llm });
      let runs = 0;
      while ((await checkOf(db, checkId)).status === "classifying" && runs < 200) {
        await job.run();
        advance(box, RUN_MS);
        runs += 1;
      }
      const check = await checkOf(db, checkId);
      expect(check.status).toBe("done");
      expect(check.capped).toBe(false);
      expect(await itemsOf(db, checkId)).toHaveLength(500);
      expect(llm.calls).toHaveLength(500);
      expect(runs).toBe(25);
      expect(box.clock.now.getTime() - connect).toBeLessThan(HOUR_MS);
    });
  });
});

describe("N1: failed calls count against the cap, and a broken prompt ends the check", () => {
  const broken = () => new Error("the answer does not fit the schema");

  test("every call fails: the check ends after 5 failed calls as no_result / model_failing, each counted at 0.002", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(
        db,
        box,
        Array.from({ length: 30 }, () => ({}))
      );
      const llm = fakeLlm(box, { fail: broken });
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(5);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "model_failing", locked_at: null });
      expectFinishedTogether(check);
      expect(Number(check.cost_usd)).toBeCloseTo(0.01, 10);
      const items = await itemsOf(db, checkId);
      expect(items).toHaveLength(5);
      expect(items.every((item) => item.category === "unsure" && item.reason_code === "classify_error")).toBe(true);
      expect(items.every((item) => Number(item.cost_usd) === 0.002)).toBe(true);
      expect(await llmCallRows(db, box.orgId)).toHaveLength(5);
    });
  });

  test("the streak lives across runs of one job: 3 failures in one run and 2 in the next end the check", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(
        db,
        box,
        Array.from({ length: 30 }, () => ({}))
      );
      const llm = fakeLlm(box, { fail: broken });
      let calls = 0;
      const job = jobOf(db, box, {
        llm,
        // The deadline stops the first run after 3 mails: each call moves the clock by 5 s.
      });
      llm.generate = new Proxy(llm.generate, {
        apply(target, self, args) {
          calls += 1;
          if (calls <= 3) advance(box, 4_100);
          return Reflect.apply(target, self, args);
        },
      });
      await job.run();
      expect((await itemsOf(db, checkId)).length).toBeLessThan(5);
      expect((await checkOf(db, checkId)).status).toBe("classifying");
      advance(box, RUN_MS);
      await job.run();
      expect(await checkOf(db, checkId)).toMatchObject({ status: "no_result", no_result_reason: "model_failing" });
      expect(llm.calls).toHaveLength(5);
    });
  });

  test("a success resets the streak: four failures, a success, four failures, a success finish the check", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(
        db,
        box,
        Array.from({ length: 10 }, () => ({}))
      );
      const llm = fakeLlm(box, { fail: (n) => (n % 5 === 0 ? undefined : broken()) });
      await jobOf(db, box, { llm }).run();
      const check = await checkOf(db, checkId);
      expect(check.status).toBe("done");
      expect(llm.calls).toHaveLength(10);
      // 8 failures at 0.002 and 2 successes at 0.01.
      expect(Number(check.cost_usd)).toBeCloseTo(0.036, 10);
    });
  });

  test("a failed call with known tokens counts at its price: failures and successes together reach the cap at 25 calls", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .insertInto("sender_rules")
        .values({ org_id: box.orgId, mailbox_id: box.mailboxId, kind: "whitelist", pattern: "friend.test" })
        .execute();
      // Every mail is whitelisted. The model answers spam on odd calls (refused: a failed call of 1 cent) and info on even calls (1 cent).
      await seedMails(
        db,
        box,
        Array.from({ length: 60 }, (_, index) => ({ from: `a${index}@friend.test` }))
      );
      const llm = fakeLlm(box, { raw: true, answer: (n) => (n % 2 === 1 ? "spam" : "info") });
      const job = jobOf(db, box, { llm });
      for (let run = 0; run < 6 && (await checkOf(db, checkId)).status === "classifying"; run += 1) {
        await job.run();
        advance(box, RUN_MS);
      }
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "done", capped: true });
      expect(Number(check.cost_usd)).toBe(0.25);
      expect(llm.calls).toHaveLength(25);
      const items = await itemsOf(db, checkId);
      expect(items.filter((item) => item.reason_code === "classify_error")).toHaveLength(13);
    });
  });
});

describe("N3: the synthetic scope with no test mail", () => {
  test("a check that classified 0 mails ends no_result / no_history and queues no notice; the same check under the scope all does", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{}, {}]);
      const owner = box.userId;
      await db.transaction().execute((trx) => linkChat(trx, box, owner, randomChatId(), box.clock.now));
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm, scope: { kind: "synthetic", testMail: { senders: [] } } }).run();
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "no_history" });
      expectFinishedTogether(check);
      expect(llm.calls).toHaveLength(0);
      const outbox = () =>
        db
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", box.orgId)
          .where("kind", "=", "trust_report_ready")
          .execute();
      expect(await outbox()).toEqual([]);

      // The scope becomes `all`: the next check still has its notice to send.
      const next = await seedClassifying(db, box);
      await jobOf(db, box, { llm: fakeLlm(box, { tokens: 100 }) }).run();
      expect((await checkOf(db, next)).status).toBe("done");
      expect(await outbox()).toHaveLength(1);
    });
  });
});
