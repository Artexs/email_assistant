import { format } from "node:util";

import { DAY_MS, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { queueHistoryCheck } from "../../src/modules/trust";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import { addMember, linkChat, randomChatId } from "./fixtures";
import { testDb } from "./helpers";
import {
  checkOf,
  expectFinishedTogether,
  fakeLlm,
  priceFixture,
  seedMails,
  withClassifyBox,
  type SeedMail,
} from "./trust-history-classify-helpers";
import { advance, jobOf, RUNNING_KEY, withHistoryBox, type HistoryBox } from "./trust-history-helpers";

// The result of the check and the report-ready notice. The model is a fake that answers the category in the
// subject of the mail; `needs_reply` moves nothing, so a mail meant not to move uses it.

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

/** Runs the job until the check leaves `classifying`. */
async function runToEnd(box: HistoryBox, checkId: string, llm = fakeLlm(box, { tokens: 100 })): Promise<void> {
  const job = jobOf(db, box, { llm });
  for (let run = 0; run < 10 && (await checkOf(db, checkId)).status === "classifying"; run += 1) {
    await job.run();
    advance(box, RUN_MS);
  }
}

/** `acted` mails that are acted on: `moved` of them are classified `notification` (would move), the rest `needs_reply` (never moves). */
function actedMails(acted: number, moved: number): SeedMail[] {
  return Array.from({ length: acted }, (_, index) => ({
    acted: true,
    category: index < moved ? "notification" : "needs_reply",
  }));
}

async function resultOf(checkId: string) {
  return (await checkOf(db, checkId)).result as Record<
    string,
    { outcome: string; acted: number; moved: number; upper: number | null; total: number; wouldMove: number }
  >;
}

describe("9. the outcome per category", () => {
  test("60 acted-on, 1 would move as notification: inconclusive (1 of 60 is not over 2%)", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, actedMails(60, 1));
      await runToEnd(box, checkId);
      const check = await checkOf(db, checkId);
      expect(check.status).toBe("done");
      expectFinishedTogether(check);
      const result = await resultOf(checkId);
      expect(result.notification).toMatchObject({
        outcome: "inconclusive",
        acted: 60,
        moved: 1,
        total: 60,
        wouldMove: 1,
      });
      expect(result.info).toMatchObject({ outcome: "inconclusive", acted: 60, moved: 0, wouldMove: 0 });
      expect(result.spam).toMatchObject({ outcome: "inconclusive", acted: 60, moved: 0 });
    });
  });

  test("60 acted-on, 2 would move: fail", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, actedMails(60, 2));
      await runToEnd(box, checkId);
      const result = await resultOf(checkId);
      expect(result.notification).toMatchObject({ outcome: "fail", moved: 2 });
      expect(result.notification?.upper).toBeGreaterThan(0.02);
    });
  });

  test("60 acted-on, none would move: inconclusive with the bound 0.060", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, actedMails(60, 0));
      await runToEnd(box, checkId);
      const result = await resultOf(checkId);
      expect(result.info).toMatchObject({ outcome: "inconclusive", moved: 0 });
      expect(result.info?.upper).toBeCloseTo(0.06, 3);
    });
  });

  test("a mail that would move but was not acted on counts in wouldMove, not in moved", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, [...actedMails(50, 0), { category: "spam" }, { category: "spam" }]);
      await runToEnd(box, checkId);
      const result = await resultOf(checkId);
      expect(result.spam).toMatchObject({ outcome: "inconclusive", acted: 50, moved: 0, total: 52, wouldMove: 2 });
    });
  });
});

describe("10. fewer than 50 acted-on mails", () => {
  test("40 acted-on: every category is no_result and the check is still done", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await seedMails(db, box, actedMails(40, 1));
      await runToEnd(box, checkId);
      const check = await checkOf(db, checkId);
      expect(check.status).toBe("done");
      const result = await resultOf(checkId);
      for (const category of ["info", "notification", "spam"]) {
        expect(result[category]).toMatchObject({ outcome: "no_result", acted: 40, upper: null });
      }
    });
  });
});

/** The outbox rows of the report notice for the organization. */
const noticeRows = (orgId: string) =>
  db
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "trust_report_ready")
    .execute();

/** Links the owner and a second owner to Telegram; a third member (an assistant) too: only the owners get the notice. */
async function linkOwners(box: HistoryBox): Promise<string[]> {
  const second = await db.transaction().execute((trx) => addMember(trx, box.orgId, "owner"));
  const assistant = await db.transaction().execute((trx) => addMember(trx, box.orgId, "assistant"));
  await db.transaction().execute(async (trx) => {
    for (const userId of [box.userId, second, assistant])
      await linkChat(trx, box, userId, randomChatId(), box.clock.now);
  });
  return [box.userId, second].sort();
}

describe("11. the report-ready notice", () => {
  test("the first done check queues one row per owner; a later check queues none, also with the first rows gone", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const owners = await linkOwners(box);
      await seedMails(db, box, actedMails(55, 0));
      await runToEnd(box, checkId);
      const rows = await noticeRows(box.orgId);
      expect(rows.map((row) => row.user_id).sort()).toEqual(owners);
      expect(new Set(rows.map((row) => row.dedup_key))).toEqual(new Set([`trust_report:${box.mailboxId}`]));

      // A second check of the same mailbox: the dedup key holds.
      const second = await queueHistoryCheck(db, box, box.mailboxId, "web");
      expect(second).not.toBeNull();
      await db
        .updateTable("history_checks")
        .set({
          status: "classifying",
          key: JSON.stringify((await checkOf(db, checkId)).key),
          window_start: (await checkOf(db, checkId)).window_start,
          backfill_done_at: box.clock.now,
        })
        .where("id", "=", second as string)
        .execute();
      await runToEnd(box, second as string);
      expect((await checkOf(db, second as string)).status).toBe("done");
      expect(await noticeRows(box.orgId)).toHaveLength(2);

      // The explicit rule, not only the dedup key: with the old rows removed a third check still queues nothing.
      await db.deleteFrom("outbox").where("org_id", "=", box.orgId).execute();
      const third = await queueHistoryCheck(db, box, box.mailboxId, "web");
      await db
        .updateTable("history_checks")
        .set({
          status: "classifying",
          key: JSON.stringify((await checkOf(db, checkId)).key),
          window_start: (await checkOf(db, checkId)).window_start,
          backfill_done_at: box.clock.now,
        })
        .where("id", "=", third as string)
        .execute();
      await runToEnd(box, third as string);
      expect((await checkOf(db, third as string)).status).toBe("done");
      expect(await noticeRows(box.orgId)).toEqual([]);
    });
  });

  test("a first no_result / no_history queues one row; the notice view holds counts and category names only", async () => {
    await withHistoryBox(db, { mails: 0 }, async (box) => {
      const owners = await linkOwners(box);
      expect(await queueHistoryCheck(db, box, box.mailboxId, "connect")).not.toBeNull();
      await jobOf(db, box).run();
      const check = (
        await db.selectFrom("history_checks").selectAll().where("mailbox_id", "=", box.mailboxId).execute()
      )[0];
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "no_history" });
      expectFinishedTogether(check as { status: string; finished_at: Date | null });
      const rows = await db
        .selectFrom("outbox")
        .selectAll()
        .where("org_id", "=", box.orgId)
        .where("kind", "=", "trust_report_ready")
        .execute();
      expect(rows.map((row) => row.user_id).sort()).toEqual(owners);
      expect(rows[0]?.view).toMatchObject({
        mailboxId: box.mailboxId,
        recommended: [],
        blocked: 3,
        checked: 0,
        reportUrl: null,
      });
    });
  });

  test("with the flag off at the end no notice is queued (an operator check runs with the flag off)", async () => {
    await withClassifyBox(db, { reason: "cli", flag: false }, async (box, checkId) => {
      await linkOwners(box);
      await seedMails(db, box, actedMails(5, 0));
      await runToEnd(box, checkId);
      expect((await checkOf(db, checkId)).status).toBe("done");
      expect(await noticeRows(box.orgId)).toEqual([]);
    });
  });

  test("a check that a model switch cut short is not the first check: the later done check queues the notice", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await linkOwners(box);
      await seedMails(db, box, actedMails(5, 0));
      await jobOf(db, box, {
        llm: fakeLlm(box),
        runningKey: { ...RUNNING_KEY, model: "other" },
      }).run();
      expect(await checkOf(db, checkId)).toMatchObject({ status: "no_result", no_result_reason: "key_changed" });
      expect(await noticeRows(box.orgId)).toEqual([]);
      const next = await db
        .selectFrom("history_checks")
        .select("id")
        .where("mailbox_id", "=", box.mailboxId)
        .where("status", "=", "queued")
        .executeTakeFirstOrThrow();
      expect(next.id).not.toBe(checkId);
      // The new check ends `done`: the cut-short check does not count as the first, so the notice goes out now.
      await db
        .updateTable("history_checks")
        .set({
          status: "classifying",
          key: JSON.stringify(RUNNING_KEY),
          window_start: new Date(box.clock.now.getTime() - 30 * DAY_MS),
          backfill_done_at: box.clock.now,
        })
        .where("id", "=", next.id)
        .execute();
      await runToEnd(box, next.id);
      expect((await checkOf(db, next.id)).status).toBe("done");
      expect(await noticeRows(box.orgId)).toHaveLength(2);
    });
  });

  test("a stopped check (three attempts) queues the notice in the same transaction", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await linkOwners(box);
      await seedMails(db, box, [{}]);
      const llm = fakeLlm(box);
      const crash = () => {
        throw new Error("crash after the call");
      };
      for (let run = 0; run < 3; run += 1) {
        await jobOf(db, box, { llm, hooks: { afterCall: crash } }).run();
        advance(box, 6 * MINUTE_MS);
      }
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "stopped" });
      expectFinishedTogether(check);
      expect(await noticeRows(box.orgId)).toHaveLength(2);
    });
  });
});

describe("the log line of a finished check", () => {
  test("one info line with counts, the outcome per category and the share of answered mail; no mail value", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      const lines: string[] = [];
      const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
      setLogFormat("json");
      setLogLevel("info");
      try {
        await seedMails(db, box, [
          { acted: true, category: "needs_reply", from: "canary-person@x.test" },
          ...actedMails(3, 0),
        ]);
        await runToEnd(box, checkId);
      } finally {
        logSpy.mockRestore();
        setLogLevel("info");
        setLogFormat(logFormatFromEnv(process.env));
      }
      const result = lines.filter((line) => line.includes("history_check_result"));
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0] as string) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        check_id: checkId,
        checked: 4,
        acted: 4,
        answered_pct: 100,
        capped: false,
        info_outcome: "no_result",
        notification_outcome: "no_result",
        spam_outcome: "no_result",
        info_moved: 0,
        notification_moved: 0,
        spam_moved: 0,
      });
      expect(lines.join("\n")).not.toContain("canary-person");
      expect(lines.join("\n")).not.toContain("Body of mail");
    });
  });
});

describe("no done or no_result row keeps finished_at empty", () => {
  test("the claim that takes a stale lock the third time ends the check with finished_at and queues the notice", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await linkOwners(box);
      await db
        .updateTable("history_checks")
        .set({ attempts: 2, locked_at: new Date(box.clock.now.getTime() - HOUR_MS) })
        .where("id", "=", checkId)
        .execute();
      await jobOf(db, box).run();
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "stopped" });
      expectFinishedTogether(check);
      // The stop of the claim queues the report notice in its transaction, one row per owner.
      expect(await noticeRows(box.orgId)).toHaveLength(2);
    });
  });
});
