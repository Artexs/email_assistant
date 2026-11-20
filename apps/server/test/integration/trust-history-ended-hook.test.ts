import { MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { claimNextCheck, HISTORY_LOCK_STALE_MS, HISTORY_MAX_ATTEMPTS, type EndedHook } from "../../src/modules/trust";
import { captureLogs, eventLines } from "../log-capture";

import { testDb } from "./helpers";
import {
  checkOf,
  expectFinishedTogether,
  fakeLlm,
  priceFixture,
  seedMails,
  withClassifyBox,
} from "./trust-history-classify-helpers";
import { advance, jobOf } from "./trust-history-helpers";

// A hook that runs when a check ends (the report notice) and throws every time must not keep the check open.
// The end of a done check fails its step and costs an attempt; the third attempt ends the check as `stopped` with no notice.
const db = testDb();
let removePrice: () => void;

beforeAll(() => {
  removePrice = priceFixture();
});

afterAll(async () => {
  removePrice();
  await db.destroy();
});

const RETRY_MS = 5 * MINUTE_MS;
const failing: EndedHook = async () => {
  throw new Error("the hook fails every time");
};

// A hook that fails with an SQL error aborts the transaction: only the savepoint lets the check end.
const sqlFailing: EndedHook = async (trx) => {
  await sql`select 1 / 0`.execute(trx);
};

describe("an end hook that throws every time", () => {
  test("a done check fails its step three times and then ends no_result / stopped", async () => {
    const capture = captureLogs();
    try {
      await withClassifyBox(db, {}, async (box, checkId) => {
        await seedMails(db, box, [{}, {}, {}]);
        const job = jobOf(db, box, { llm: fakeLlm(box), hooks: { onEnded: failing } });
        const states: string[] = [];
        for (let run = 0; run < HISTORY_MAX_ATTEMPTS; run += 1) {
          await job.run();
          const check = await checkOf(db, checkId);
          states.push(`${check.status}:${check.attempts}`);
          advance(box, RETRY_MS + 1000);
        }
        // Two failed steps keep it open and unlocked; the third ends it.
        expect(states).toEqual(["classifying:1", "classifying:2", "no_result:3"]);
        const check = await checkOf(db, checkId);
        expect(check).toMatchObject({ status: "no_result", no_result_reason: "stopped", locked_at: null });
        expectFinishedTogether(check);
        // No fourth run: the check is closed.
        await job.run();
        expect((await checkOf(db, checkId)).attempts).toBe(HISTORY_MAX_ATTEMPTS);
      });
    } finally {
      capture.stop();
    }
    // The hook of the third attempt failed too: one warning, and the check ended anyway.
    expect(eventLines(capture.lines, "history_ended_hook_failed")).toHaveLength(1);
  });

  test("the take-back of a stale lock on the third attempt ends the check with a failing hook", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .updateTable("history_checks")
        .set({
          attempts: HISTORY_MAX_ATTEMPTS - 1,
          locked_at: new Date(box.clock.now.getTime() - 2 * HISTORY_LOCK_STALE_MS),
        })
        .where("id", "=", checkId)
        .execute();
      const claim = await claimNextCheck(db, box, box.clock.now, failing);
      expect(claim).toMatchObject({ kind: "stopped", checkId });
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "stopped", locked_at: null });
      expectFinishedTogether(check);
    });
  });

  test("a hook that fails with an SQL error (an aborted transaction) still lets the check end stopped", async () => {
    await withClassifyBox(db, {}, async (box, checkId) => {
      await db
        .updateTable("history_checks")
        .set({
          attempts: HISTORY_MAX_ATTEMPTS - 1,
          locked_at: new Date(box.clock.now.getTime() - 2 * HISTORY_LOCK_STALE_MS),
        })
        .where("id", "=", checkId)
        .execute();
      const claim = await claimNextCheck(db, box, box.clock.now, sqlFailing);
      expect(claim).toMatchObject({ kind: "stopped", checkId });
      const check = await checkOf(db, checkId);
      expect(check).toMatchObject({ status: "no_result", no_result_reason: "stopped", locked_at: null });
      expectFinishedTogether(check);
    });
  });
});
