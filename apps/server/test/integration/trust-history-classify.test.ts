import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { countLlmCallsSince, recordLlmCall } from "../../src/modules/audit";
import { createLlmPause } from "../../src/modules/triage";
import { SoftError } from "../../src/platform/errors";
import { LlmBlockedError } from "../../src/platform/llm";

import { testDb } from "./helpers";
import {
  CENT_TOKENS,
  checkOf,
  expectFinishedTogether,
  fakeLlm,
  itemsOf,
  llmCallRows,
  MODEL,
  priceFixture,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { advance, jobOf, MINUTE_MS, RUNNING_KEY, theCheck } from "./trust-history-helpers";

// F110 stage 07, step 1: the classify step. The box holds a check in `classifying` and mail rows that the test places; the model is
// a fake with a fixed price (one cent per 10,000 tokens). The backfill and the flags steps are tested in trust-history-job.test.ts.

const db = testDb();
let removePrice: () => void;

beforeAll(() => {
  removePrice = priceFixture();
});

afterAll(async () => {
  removePrice();
  await db.destroy();
});

const RUN_MS = 15_000;
const countOf = async (table: "triage_results" | "history_check_items", orgId: string): Promise<number> =>
  (await db.selectFrom(table).select("email_id").where("org_id", "=", orgId).execute()).length;

describe("1. the sample: acted-on mail first, and a stored result under the check key makes no call", () => {
  test("60 window mails, 10 acted-on, one of them triaged under the key: 20 items, the acted-on first, 19 calls", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const mails = Array.from({ length: 60 }, (_, index) => ({ acted: index >= 30 && index < 40 }));
      const ids = await seedMails(db, box, mails);
      const triagedId = ids[35] as string;
      await db
        .insertInto("triage_results")
        .values({
          org_id: box.orgId,
          email_id: triagedId,
          category: "notification",
          confidence: 0.8,
          reason_code: "stored",
          model: MODEL,
          prompt_version: RUNNING_KEY.promptVersion,
        })
        .execute();
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();

      const items = await itemsOf(db, checkId);
      expect(items).toHaveLength(20);
      const acted = new Set(ids.slice(30, 40));
      expect(
        items
          .filter((item) => item.acted_on)
          .map((item) => item.email_id)
          .sort()
      ).toEqual([...acted].sort());
      // Every acted-on mail is in the first run: the fill takes the remaining ten places.
      expect(items.filter((item) => acted.has(item.email_id))).toHaveLength(10);
      expect(llm.calls).toHaveLength(19);
      const triaged = items.find((item) => item.email_id === triagedId);
      expect(triaged).toMatchObject({ source: "triage_result", category: "notification", cost_usd: "0" });
      expect(items.filter((item) => item.source === "classified")).toHaveLength(19);
      // The check keeps its lock-free state between runs and the sum of the item costs.
      const check = await checkOf(db, checkId);
      expect(check.status).toBe("classifying");
      expect(Number(check.cost_usd)).toBeCloseTo(0.19, 10);
      // The classify step saves no triage result: the one stored row is still the only one (review 5 TG2).
      expect(await countOf("triage_results", box.orgId)).toBe(1);
    });
  });

  test("a mail that was written by the mailbox itself, has no body, lies outside INBOX or is older than the window is not sampled", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const address = (
        await db.selectFrom("mailboxes").select("address").where("id", "=", box.mailboxId).executeTakeFirstOrThrow()
      ).address;
      const ids = await seedMails(db, box, [
        {},
        { from: address.toUpperCase() },
        { body: null },
        { folder: "Archive" },
        { receivedAt: new Date(box.clock.now.getTime() - 31 * 86_400_000) },
      ]);
      await jobOf(db, box, { llm: fakeLlm(box) }).run();
      expect((await itemsOf(db, checkId)).map((item) => item.email_id)).toEqual([ids[0] as string]);
    });
  });
});

describe("2. a result of another model is not reused", () => {
  test("a mail triaged by model A under check key B gets one call and the source classified", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const [id] = await seedMails(db, box, [{}]);
      await db
        .insertInto("triage_results")
        .values({
          org_id: box.orgId,
          email_id: id as string,
          category: "spam",
          confidence: 0.9,
          reason_code: "stored",
          model: "model-a",
          prompt_version: RUNNING_KEY.promptVersion,
        })
        .execute();
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(1);
      expect(await itemsOf(db, checkId)).toMatchObject([{ source: "classified", category: "info" }]);
    });
  });

  test("a model_switch check judges the mail again even under the same key; a rule result is still reused", async () => {
    await withClassifyBox(db, { reason: "model_switch" }, async (box, checkId) => {
      const [same, rule] = await seedMails(db, box, [{}, {}]);
      await db
        .insertInto("triage_results")
        .values([
          {
            org_id: box.orgId,
            email_id: same as string,
            category: "info",
            confidence: 0.9,
            reason_code: "stored",
            model: MODEL,
            prompt_version: RUNNING_KEY.promptVersion,
          },
          {
            org_id: box.orgId,
            email_id: rule as string,
            category: "spam",
            confidence: 1,
            reason_code: "blocklist",
            model: null,
            prompt_version: null,
          },
        ])
        .execute();
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(1);
      const items = await itemsOf(db, checkId);
      expect(items.find((item) => item.email_id === same)?.source).toBe("classified");
      expect(items.find((item) => item.email_id === rule)).toMatchObject({ source: "rule", category: "spam" });
    });
  });

  test("a sender on the blocklist is spam from the rule with no call", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .insertInto("sender_rules")
        .values({ org_id: box.orgId, mailbox_id: box.mailboxId, kind: "blocklist", pattern: "junk@x.test" })
        .execute();
      await seedMails(db, box, [{ from: "junk@x.test" }]);
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(0);
      expect(await itemsOf(db, checkId)).toMatchObject([
        { source: "rule", category: "spam", reason_code: "blocklist", would_move: true },
      ]);
    });
  });
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
        outcome: "ok",
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: 1,
        at,
      };
      for (let n = 0; n < 300; n += 1) await recordLlmCall(db, box, base);
      for (let n = 0; n < 50; n += 1) await recordLlmCall(db, box, { ...base, historyCheckId: checkId });
      const since = new Date(at.getTime() - 3_600_000);
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
      expect(box.clock.now.getTime() - connect).toBeLessThan(60 * MINUTE_MS);
    });
  });
});

describe("the pause of the model client", () => {
  test("a pause that runs makes no call and no attempt: the check waits for its end", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{}]);
      const pause = createLlmPause();
      const until = pause.trip("soft", "rate_limited", box.clock.now);
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm, pause }).run();
      expect(llm.calls).toHaveLength(0);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "classifying", attempts: 0, locked_at: null });
      expect(check.next_attempt_at.getTime()).toBe(until.getTime());
    });
  });

  test("a soft error trips the pause: the items before it stay, the check waits with no attempt", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{}, {}, {}]);
      const pause = createLlmPause();
      const llm = fakeLlm(box, { fail: (n) => (n === 3 ? new SoftError("rate limited") : undefined) });
      await jobOf(db, box, { llm, pause }).run();
      expect(await itemsOf(db, checkId)).toHaveLength(2);
      expect(pause.isPaused(box.clock.now)).toBe(true);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "classifying", attempts: 0, locked_at: null });
      expect(check.next_attempt_at.getTime()).toBe(pause.pausedUntil(box.clock.now)?.getTime() as number);
    });
  });
});

describe("a mail that the model cannot judge", () => {
  test("a blocked answer is an unsure item that is not acted on and is not asked again", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const ids = await seedMails(db, box, [{ acted: true }, {}]);
      const llm = fakeLlm(box, { fail: (n) => (n === 1 ? new LlmBlockedError(MODEL) : undefined) });
      const job = jobOf(db, box, { llm });
      await job.run();
      const items = await itemsOf(db, checkId);
      expect(items).toHaveLength(2);
      const failed = items.find((item) => item.reason_code === "llm_blocked");
      expect(failed).toMatchObject({ category: "unsure", acted_on: false, would_move: false, source: "classified" });
      expect(ids).toContain(failed?.email_id as string);
      expect(llm.calls).toHaveLength(2);
      expect(await checkOf(db, checkId)).toMatchObject({ status: "done" });
    });
  });
});

describe("the scope of the model", () => {
  test("with the scope synthetic only test mail is classified", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const ids = await seedMails(db, box, [
        {},
        { messageId: "<synthetic-1@ea-seed.test>" },
        { from: "tester@lab.test" },
      ]);
      const llm = fakeLlm(box);
      await jobOf(db, box, {
        llm,
        scope: { kind: "synthetic", testMail: { senders: ["tester@lab.test"] } },
        testMail: { senders: ["tester@lab.test"] },
      }).run();
      const got = (await itemsOf(db, checkId)).map((item) => item.email_id).sort();
      expect(got).toEqual([ids[1] as string, ids[2] as string].sort());
    });
  });
});

describe("the time budget of a run", () => {
  test("a slow organization does not hold the next one: it starts the next run, the longest-waiting first", async () => {
    await withClassifyBox(db, {}, async (first, firstCheck) => {
      await withClassifyBox(db, {}, async (second, secondCheck) => {
        await seedMails(db, first, [{}, {}, {}]);
        await seedMails(db, second, [{}]);
        // The first check waited longer.
        await db
          .updateTable("history_checks")
          .set({ next_attempt_at: new Date(first.clock.now.getTime() - 10 * MINUTE_MS) })
          .where("id", "=", firstCheck)
          .execute();
        await db
          .updateTable("history_checks")
          .set({ next_attempt_at: new Date(first.clock.now.getTime() - 5 * MINUTE_MS) })
          .where("id", "=", secondCheck)
          .execute();
        // Each call takes 13 s of the clock: the first mail runs, then the 12 s budget of the run is gone.
        const llm = fakeLlm(first, { delayMs: 13_000 });
        const job = jobOf(db, first, { llm });
        await job.run();
        expect(await itemsOf(db, firstCheck)).toHaveLength(1);
        expect(await itemsOf(db, secondCheck)).toHaveLength(0);
        expect(await checkOf(db, secondCheck)).toMatchObject({ attempts: 0, locked_at: null });
        // The next run starts with the second organization: it waited longer now.
        advance(first, RUN_MS);
        await job.run();
        expect(await itemsOf(db, secondCheck)).toHaveLength(1);
      });
    });
  });
});

describe("no mail text, subject or address in an item row", () => {
  test("the item rows hold codes, a category, a confidence and money only", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{ from: "canary-person@x.test", acted: true }]);
      await jobOf(db, box, { llm: fakeLlm(box, { tokens: CENT_TOKENS }) }).run();
      const check = await theCheck(db, box);
      const text = JSON.stringify([await itemsOf(db, checkId), check]);
      expect(text).not.toContain("canary-person");
      expect(text).not.toContain("Body of mail");
      expect(text).not.toContain("item 0");
    });
  });
});
