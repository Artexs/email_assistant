import { createHash, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { countLlmCallsSince, recordLlmCall } from "../../src/modules/audit";
import { classifyStored, createLlmPause, loadTriageMailbox } from "../../src/modules/triage";
import { claimNextCheck, historyActedOn } from "../../src/modules/trust";
import { recordItem } from "../../src/modules/trust/history-items";
import { SoftError } from "../../src/platform/errors";
import { LlmBlockedError } from "../../src/platform/llm";

import { linkChat, randomChatId } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import {
  CENT_TOKENS,
  checkOf,
  expectFinishedTogether,
  fakeLlm,
  itemsOf,
  llmCallRows,
  MODEL,
  priceFixture,
  seedClassifying,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { advance, jobOf, RUNNING_KEY, theCheck, type HistoryBox } from "./trust-history-helpers";

// The classify step. The box holds a check in `classifying` and mail rows that the test places; the model is
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
      // The classify step saves no triage result: the one stored row is still the only one.
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
        { receivedAt: new Date(box.clock.now.getTime() - 31 * DAY_MS) },
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

  test("a stored result of a VIP sender would not be moved; the same result of another sender would", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const [vip, plain] = await seedMails(db, box, [{}, {}]);
      await db
        .insertInto("triage_results")
        .values(
          [vip, plain].map((emailId, index) => ({
            org_id: box.orgId,
            email_id: emailId as string,
            category: "info",
            confidence: 0.9,
            reason_code: "stored",
            model: MODEL,
            prompt_version: RUNNING_KEY.promptVersion,
            vip: index === 0,
          }))
        )
        .execute();
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(0);
      const items = await itemsOf(db, checkId);
      expect(items.find((item) => item.email_id === vip)).toMatchObject({ source: "triage_result", would_move: false });
      expect(items.find((item) => item.email_id === plain)).toMatchObject({
        source: "triage_result",
        would_move: true,
      });
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
    await withClassifyBox(db, {}, async (one, oneCheck) => {
      await withClassifyBox(db, {}, async (two, twoCheck) => {
        // The organization that waited longer has the LARGER id, so a listing by id alone would pick the wrong one first.
        const [slow, fast] = one.orgId > two.orgId ? [one, two] : [two, one];
        const [slowCheck, fastCheck] = one.orgId > two.orgId ? [oneCheck, twoCheck] : [twoCheck, oneCheck];
        await seedMails(db, slow, [{}, {}, {}]);
        await seedMails(db, fast, [{}]);
        const waited = (box: HistoryBox, ms: number) => new Date(box.clock.now.getTime() - ms);
        await db
          .updateTable("history_checks")
          .set({ next_attempt_at: waited(slow, 10 * MINUTE_MS) })
          .where("id", "=", slowCheck)
          .execute();
        await db
          .updateTable("history_checks")
          .set({ next_attempt_at: waited(slow, 5 * MINUTE_MS) })
          .where("id", "=", fastCheck)
          .execute();
        // Each call takes 13 s of the clock: the first mail runs, then the 12 s budget of the run is gone.
        const llm = fakeLlm(slow, { delayMs: 13_000 });
        const job = jobOf(db, slow, { llm });
        await job.run();
        expect(await itemsOf(db, slowCheck)).toHaveLength(1);
        expect(await itemsOf(db, fastCheck)).toHaveLength(0);
        expect(await checkOf(db, fastCheck)).toMatchObject({ attempts: 0, locked_at: null });
        // The next run starts with the organization that was left out: it waited longer now.
        advance(slow, RUN_MS);
        await job.run();
        expect(await itemsOf(db, fastCheck)).toHaveLength(1);
        expect(fast.orgId).not.toBe(slow.orgId);
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

describe("the sample order and the lock", () => {
  test("the fill follows md5(check id || mail id)", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const ids = await seedMails(
        db,
        box,
        Array.from({ length: 60 }, () => ({}))
      );
      await jobOf(db, box, { llm: fakeLlm(box, { tokens: 100 }) }).run();
      const expected = [...ids]
        .map((id) => ({ id, hash: createHash("md5").update(`${checkId}${id}`).digest("hex") }))
        .sort((a, b) => (a.hash < b.hash ? -1 : 1))
        .slice(0, 20)
        .map((entry) => entry.id)
        .sort();
      expect((await itemsOf(db, checkId)).map((item) => item.email_id)).toEqual(expected);
    });
  });

  test("a run whose lock was taken back writes no item and adds no cost", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{}, {}]);
      const llm = fakeLlm(box);
      await jobOf(db, box, {
        llm,
        hooks: {
          // Another run takes the check back after 10 minutes while this one is between its call and its commit.
          afterCall: async () => {
            await db
              .updateTable("history_checks")
              .set({ locked_at: new Date(box.clock.now.getTime() + HOUR_MS) })
              .where("id", "=", checkId)
              .execute();
          },
        },
      }).run();
      expect(llm.calls).toHaveLength(1);
      expect(await itemsOf(db, checkId)).toHaveLength(0);
      expect(Number((await checkOf(db, checkId)).cost_usd)).toBe(0);
    });
  });

  test("recordItem writes one item per mail: a second write of the same mail changes nothing", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const [id] = await seedMails(db, box, [{}]);
      const claim = await claimNextCheck(db, box, box.clock.now);
      if (claim.kind !== "claimed") throw new Error("not claimed");
      const item = {
        emailId: id as string,
        category: "info" as const,
        confidence: 0.9,
        reasonCode: "x",
        wouldMove: true,
        actedOn: false,
        source: "classified" as const,
        costUsd: 0.01,
      };
      expect(await recordItem(db, box, claim.check, item)).toBe(0.01);
      expect(await recordItem(db, box, claim.check, item)).toBeNull();
      expect(Number((await checkOf(db, checkId)).cost_usd)).toBe(0.01);
      expect(await itemsOf(db, checkId)).toHaveLength(1);
    });
  });
});

describe("acted on (the seam of the sent signals)", () => {
  test("\\Answered, \\Flagged, or feedback with the true category urgent or needs_reply; no other mail", async () => {
    await withClassifyBox(db, {}, async (box) => {
      const ids = await seedMails(db, box, [{ acted: true }, {}, {}, {}, {}, {}, {}]);
      const [answered, flagged, urgent, needsReply, info, plain, other] = ids as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      await db
        .updateTable("email_flags")
        .set({ answered: false, flagged: true })
        .where("email_id", "=", answered)
        .execute();
      await db
        .insertInto("email_flags")
        .values({
          email_id: flagged,
          org_id: box.orgId,
          seen: true,
          answered: true,
          flagged: false,
          checked_at: box.clock.now,
        })
        .execute();
      const feedback = (emailId: string, trueCategory: string) =>
        db
          .insertInto("triage_feedback")
          .values({
            org_id: box.orgId,
            email_id: emailId,
            verdict: "wrong",
            true_category: trueCategory,
            source: "web",
          })
          .execute();
      await feedback(urgent, "urgent");
      await feedback(needsReply, "needs_reply");
      await feedback(info, "info");
      // An unknown mail of another organization never counts.
      const acted = await historyActedOn(db, box, [...ids, other]);
      expect([...acted].sort()).toEqual([answered, flagged, urgent, needsReply].sort());
      expect(acted.has(plain)).toBe(false);
    });
  });
});

describe("classifyStored refuses a mail of another mailbox", () => {
  test("the snapshot of one mailbox never judges the mail of a second mailbox of the organization", async () => {
    await withClassifyBox(db, {}, async (box) => {
      const second = await db.transaction().execute((trx) => addMailbox(trx, box));
      const [theirs] = await db
        .insertInto("emails")
        .values({
          org_id: box.orgId,
          mailbox_id: second,
          dedup_key: `test:${randomUUID()}`,
          thread_key: "t",
          content_hash: "h",
          uid: 1,
          received_at: box.clock.now,
          body_text: "x",
        })
        .returning("id")
        .execute();
      const snapshot = await loadTriageMailbox(db, box, {
        mailboxId: box.mailboxId,
        runningKey: RUNNING_KEY,
        senders: [],
        now: box.clock.now,
      });
      if (snapshot.kind !== "ok") throw new Error("no snapshot");
      const llm = fakeLlm(box);
      await expect(
        classifyStored(
          { db, llm, testMail: { senders: [] }, mailbox: snapshot.mailbox, now: () => box.clock.now },
          box,
          theirs?.id as string
        )
      ).rejects.toThrow("history mail not found");
      expect(llm.calls).toHaveLength(0);
    });
  });
});

describe("the review gaps of stage 07", () => {
  test("TG1: a VIP sender with a model answer of info would not be moved; another sender would", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .insertInto("sender_rules")
        .values({ org_id: box.orgId, mailbox_id: box.mailboxId, kind: "vip", pattern: "boss@x.test" })
        .execute();
      const [vip, plain] = await seedMails(db, box, [{ from: "boss@x.test" }, { from: "other@x.test" }]);
      await jobOf(db, box, { llm: fakeLlm(box, { tokens: 100 }) }).run();
      const items = await itemsOf(db, checkId);
      expect(items.find((item) => item.email_id === vip)).toMatchObject({
        source: "classified",
        category: "info",
        would_move: false,
      });
      expect(items.find((item) => item.email_id === plain)).toMatchObject({
        source: "classified",
        category: "info",
        would_move: true,
      });
    });
  });

  test("TG2: a spam answer for a whitelisted sender is refused: an unsure item that is not moved, counted at its tokens", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .insertInto("sender_rules")
        .values({ org_id: box.orgId, mailbox_id: box.mailboxId, kind: "whitelist", pattern: "friend.test" })
        .execute();
      await seedMails(db, box, [{ from: "a@friend.test", category: "spam" }]);
      await jobOf(db, box, { llm: fakeLlm(box, { raw: true }) }).run();
      const check = await checkOf(db, checkId);
      expect(await itemsOf(db, checkId)).toMatchObject([
        { category: "unsure", reason_code: "classify_error", would_move: false, acted_on: false, cost_usd: "0.01" },
      ]);
      expect(Number(check.cost_usd)).toBe(0.01);
      // The row of the call names the tokens that the answer used.
      expect((await llmCallRows(db, box.orgId))[0]?.data).toMatchObject({
        tokens_in: CENT_TOKENS,
        historyCheckId: checkId,
      });
    });
  });

  test("TG3: a model that answers without a price ends the check no_result / cost_unknown: no item, the call row stays", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [{}, {}]);
      const llm = fakeLlm(box, { usageModel: "model-price-lost" });
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(1);
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "cost_unknown", locked_at: null });
      expectFinishedTogether(check);
      expect(await itemsOf(db, checkId)).toHaveLength(0);
      expect(await llmCallRows(db, box.orgId)).toHaveLength(1);
    });
  });

  test("TG4: a mail with two stored results reuses the newest", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const [id] = await seedMails(db, box, [{}]);
      const row = (category: string, createdAt: Date) => ({
        org_id: box.orgId,
        email_id: id as string,
        category,
        confidence: 0.9,
        reason_code: "stored",
        model: MODEL,
        prompt_version: RUNNING_KEY.promptVersion,
        created_at: createdAt,
      });
      await db
        .insertInto("triage_results")
        .values([
          row("urgent", new Date(box.clock.now.getTime() - 2 * HOUR_MS)),
          row("notification", new Date(box.clock.now.getTime() - HOUR_MS)),
          row("spam", new Date(box.clock.now.getTime() - 3 * HOUR_MS)),
        ])
        .execute();
      const llm = fakeLlm(box);
      await jobOf(db, box, { llm }).run();
      expect(llm.calls).toHaveLength(0);
      expect(await itemsOf(db, checkId)).toMatchObject([{ source: "triage_result", category: "notification" }]);
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
