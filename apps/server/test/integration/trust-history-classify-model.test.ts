import { MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createLlmPause } from "../../src/modules/triage";
import { SoftError } from "../../src/platform/errors";
import { LlmBlockedError } from "../../src/platform/llm";

import { testDb } from "./helpers";
import {
  checkOf,
  fakeLlm,
  itemsOf,
  MODEL,
  priceFixture,
  RUN_MS,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { advance, jobOf, type HistoryBox } from "./trust-history-helpers";

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
