import { HOUR_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
import { jobOf, RUNNING_KEY } from "./trust-history-helpers";

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
