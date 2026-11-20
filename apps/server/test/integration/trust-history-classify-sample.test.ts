import { createHash, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { classifyStored, loadTriageMailbox } from "../../src/modules/triage";
import { claimNextCheck, historyActedOn } from "../../src/modules/trust";
import { recordItem } from "../../src/modules/trust/history-items";

import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import {
  CENT_TOKENS,
  checkOf,
  fakeLlm,
  itemsOf,
  MODEL,
  priceFixture,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { jobOf, RUNNING_KEY, theCheck } from "./trust-history-helpers";

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
