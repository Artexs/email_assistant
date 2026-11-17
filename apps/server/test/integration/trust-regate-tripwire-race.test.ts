import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { regateAll, type RegateDeps } from "../../src/modules/trust";
import { captureLogs, eventLines } from "../log-capture";

import { testDb } from "./helpers";
import { insertCheckRow } from "./trust-fixtures";
import { GO_GATE, NOW, RUNNING_KEY, tripwireOf, withTripBox, type TripBox } from "./trust-tripwire-helpers";

// The re-gate and the tripwire both pause a category under the settings row lock, and both take that lock FIRST (before the trip row).
// Two connections, committed rows: a pause by both at once gives one trip and one notice per owner, and no deadlock (SQLSTATE 40P01).
// A failed trip or a failed mailbox is logged, not thrown, so the tests read the log lines for the failure events.
const db = testDb();
const other = testDb();

afterAll(async () => {
  await Promise.all([db.destroy(), other.destroy()]);
});

// The re-gate runs on key B with no gate file: a grant on the running key of the tripwire tests has no evidence under B (model switch).
const KEY_B = { ...RUNNING_KEY, model: "tripwire-test-model-b" };
const regateDeps = (over: Partial<RegateDeps> = {}): RegateDeps => ({
  db: other,
  gate: { index: { files: [] }, runningKey: KEY_B },
  testMail: NO_TEST_SENDERS,
  settingsOf: (trx) => settingsDeps(trx, () => NOW, GO_GATE),
  run: "job",
  ...over,
});

// A `fail` of a check that ended after the grant: the tripwire pauses the category with the reason `history_fail`.
async function addFail(box: TripBox): Promise<void> {
  await db.transaction().execute((trx) =>
    insertCheckRow(trx, box, box.mailboxId, {
      status: "done",
      finished_at: new Date("2026-11-02T12:00:00Z"),
      result: JSON.stringify({ spam: { outcome: "fail", acted: 12, moved: 3, upper: 0.4, total: 100, wouldMove: 30 } }),
    })
  );
}

const tripsOf = (box: TripBox) =>
  db.selectFrom("autonomy_trips").selectAll().where("mailbox_id", "=", box.mailboxId).execute();
const noticesOf = (box: TripBox) =>
  db
    .selectFrom("outbox")
    .select("user_id")
    .where("org_id", "=", box.orgId)
    .where("kind", "=", "autonomy_paused")
    .execute();

async function waitForLockWait(): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`.execute(db);
    if ((rows[0]?.n ?? 0) > 0) return;
    if (Date.now() >= deadline) throw new Error("no session waits for a lock");
    await Bun.sleep(10);
  }
}

function expectNoFailure(lines: readonly string[]): void {
  expect(eventLines(lines, "tripwire_failed")).toEqual([]);
  expect(eventLines(lines, "trust_regate_mailbox_failed")).toEqual([]);
  expect(lines.filter((line) => line.includes("40P01") || line.includes("deadlock"))).toEqual([]);
  for (const done of eventLines(lines, "trust_regate_done")) expect(done).toMatchObject({ failed: 0 });
}

describe("a re-gate run and a tripwire run on one mailbox", () => {
  test("the tripwire waits for the settings lock that the re-gate holds: both end, one trip, one notice per owner, no 40P01", async () => {
    const capture = captureLogs();
    try {
      await withTripBox(db, { grants: [{ category: "spam", by: "regate" }] }, async (box) => {
        await addFail(box);
        let held!: () => void;
        const holding = new Promise<void>((resolve) => (held = resolve));
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        // The re-gate takes the lock first and keeps it until the tripwire waits for it.
        const regate = regateAll(
          regateDeps({
            hooks: {
              afterLock: async (_ctx, mailboxId) => {
                if (mailboxId !== box.mailboxId) return;
                held();
                await released;
              },
            },
          }),
          NOW
        );
        await holding;
        const tripwire = tripwireOf(db).run();
        await waitForLockWait();
        release();
        const result = await regate;
        await tripwire;
        expect(result.paused).toBe(1);
        expect(await tripsOf(box)).toHaveLength(1);
        expect(await noticesOf(box)).toHaveLength(2);
        const policy = (
          await db
            .selectFrom("mailbox_settings")
            .select("category_policy")
            .where("mailbox_id", "=", box.mailboxId)
            .executeTakeFirstOrThrow()
        ).category_policy as Record<string, { auto?: boolean } | undefined>;
        expect(policy.spam?.auto).toBe(false);
      });
    } finally {
      capture.stop();
    }
    expectNoFailure(capture.lines);
  });

  test("ten rounds started together: no deadlock, one trip and one notice per owner in each", async () => {
    const capture = captureLogs();
    try {
      for (let round = 0; round < 10; round += 1) {
        await withTripBox(db, { grants: [{ category: "spam", by: "regate" }] }, async (box) => {
          await addFail(box);
          await Promise.all([regateAll(regateDeps(), NOW), tripwireOf(db).run(), regateAll(regateDeps({ db }), NOW)]);
          expect(await tripsOf(box)).toHaveLength(1);
          expect(await noticesOf(box)).toHaveLength(2);
        });
      }
    } finally {
      capture.stop();
    }
    expectNoFailure(capture.lines);
  });
});
