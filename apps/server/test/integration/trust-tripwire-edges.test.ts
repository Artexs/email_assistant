import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { listMoveCorrections } from "../../src/modules/actions";
import { lockMailboxSettings } from "../../src/modules/config";
import { setCategoryAutoWithEvidence } from "../../src/modules/trust";
import { createDb } from "../../src/platform/db";

import { testDb } from "./helpers";
import { addMailbox, insertCheckRow } from "./trust-fixtures";
import {
  addCorrected,
  addFailedCheck,
  addMove,
  addFeedback,
  at,
  GO_GATE,
  GRANT_AT,
  NOW,
  pausedNotices,
  policyOf,
  RUNNING_KEY,
  tripsOf,
  tripwireOf,
  withTripBox,
  type TripBox,
} from "./trust-tripwire-helpers";

// Edges of the tripwire that the review of stage 09 found open (see `review-9.md` in the ticket folder of F110): the lock against a grant in flight, a history
// check that ended with no result, the exact edge of the 7-day window in SQL, an unreadable check result, and two moves of one mail.
// Committed rows and a fixed clock (the grant is 2026-11-01T10:00Z, now is 2026-11-08T12:00Z, so the window starts 11-01T12:00Z).
const db = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role reads the lock table");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([db.destroy(), ownerDb.destroy()]);
});

const run = () => tripwireOf(db).run();

// True when a session waits for a lock that session `holderPid` holds. `pg_locks` shows the sessions of every role.
async function someoneWaitsFor(holderPid: number): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pg_locks l
    where not l.granted and ${holderPid} = any (pg_blocking_pids(l.pid))`.execute(ownerDb);
  return (rows[0]?.n ?? 0) > 0;
}

async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await someoneWaitsFor(holderPid))) {
    if (Date.now() >= deadline) throw new Error("the tripwire never waited for the settings lock");
    await Bun.sleep(10);
  }
}

describe("the settings lock against a grant in flight", () => {
  test("the user holds the settings row, turns `auto` off and on again; the tripwire waits, then pauses nothing", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      const later = new Date(NOW.getTime() - 30_000);
      let held!: (pid: number) => void;
      const userHolds = new Promise<number>((resolve) => (held = resolve));
      const user = db.transaction().execute(async (trx) => {
        await lockMailboxSettings(trx, box, box.mailboxId);
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
        const pid = rows[0]?.pid ?? 0;
        held(pid);
        // The user commits only after the tripwire waits on this row: the trip has judged the old grant by then.
        await waitUntilBlockedBy(pid);
        const deps = { settings: settingsDeps(trx, () => later, GO_GATE), testMail: { senders: [] } };
        for (const auto of [false, true]) {
          const result = await setCategoryAutoWithEvidence(deps, box, box.mailboxId, {
            category: "info",
            auto,
            force: false,
            actor: box.owner1,
          });
          expect(result.kind).toBe("changed");
        }
      });
      await userHolds;
      await Promise.all([user, run()]);
      expect(await tripsOf(db, box)).toHaveLength(0);
      expect(await pausedNotices(db, box)).toHaveLength(0);
      const policy = await policyOf(db, box);
      expect(policy.info?.auto).toBe(true);
      expect(policy.info?.grant?.at).toBe(later.toISOString());
    });
  });
});

describe("history checks that ended with no result", () => {
  test("a `done` check whose category outcome is `no_result` does not trip", async () => {
    await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
      const entry = { acted: 0, moved: 0, upper: 1, total: 0, wouldMove: 0, outcome: "no_result" };
      await db.transaction().execute((trx) =>
        insertCheckRow(trx, box, box.mailboxId, {
          status: "done",
          result: JSON.stringify({ spam: entry }),
          finished_at: at("2026-11-02T12:00:00Z"),
        })
      );
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  for (const reason of ["model_failing", "cost_unknown"] as const) {
    test(`a newer \`no_result\` check (${reason}) does not trip and does not hide an older \`fail\``, async () => {
      await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
        await db.transaction().execute((trx) =>
          insertCheckRow(trx, box, box.mailboxId, {
            status: "no_result",
            no_result_reason: reason,
            finished_at: at("2026-11-03T12:00:00Z"),
          })
        );
        await run();
        expect(await tripsOf(db, box)).toHaveLength(0);
        await addFailedCheck(db, box, "2026-11-02T12:00:00Z", ["spam"]);
        await run();
        expect((await tripsOf(db, box)).map((trip) => trip.reason)).toEqual(["history_fail"]);
      });
    });
  }
});

describe("the edge of the 7-day window in the reader", () => {
  test("a correction exactly at now - 7 days counts; 1 ms earlier does not", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const move = { category: "info", appliedAt: "2026-11-01T11:00:00Z" } as const;
      await addCorrected(db, box, move, { at: "2026-11-01T12:00:00.000Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-05T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(1);
    });
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const move = { category: "info", appliedAt: "2026-11-01T11:00:00Z" } as const;
      await addCorrected(db, box, move, { at: "2026-11-01T11:59:59.999Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-05T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });
});

describe("a history result that does not parse", () => {
  test("it stops no other mailbox of the organization: their corrections still trip", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const secondId = await db.transaction().execute((trx) => addMailbox(trx, box));
      // The watch order is the mailbox id order: the unreadable result sits on the mailbox that comes first.
      const [firstId, lastId] = [box.mailboxId, secondId].sort();
      const first: TripBox = { ...box, mailboxId: firstId as string };
      const last: TripBox = { ...box, mailboxId: lastId as string };
      await db
        .updateTable("mailbox_settings")
        .set({
          mode: "assist",
          category_policy: JSON.stringify({
            info: { auto: true, threshold: 0.8, grant: { key: RUNNING_KEY, by: "evidence", at: GRANT_AT } },
          }),
        })
        .where("mailbox_id", "=", secondId)
        .execute();
      await db.transaction().execute((trx) =>
        insertCheckRow(trx, box, first.mailboxId, {
          status: "done",
          result: JSON.stringify({ info: { outcome: "bogus" } }),
          finished_at: at("2026-11-02T12:00:00Z"),
        })
      );
      await addCorrected(db, last, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, last, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, last)).toHaveLength(1);
      expect(await tripsOf(db, first)).toHaveLength(0);
    });
  });
});

describe("two original moves of one mail", () => {
  test("the reader returns one row: the newest move by `applied_at`", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const emailId = await addMove(db, box, { category: "info", appliedAt: "2026-11-02T09:00:00Z" });
      // A second original move of the same mail (a later retry), with its own time.
      await db
        .insertInto("actions")
        .values({
          org_id: box.orgId,
          email_id: emailId,
          type: "move",
          status: "undone",
          payload: JSON.stringify({ folder: "newsletters" }),
          idempotency_key: `second:${emailId}`,
          applied_at: at("2026-11-04T09:00:00Z"),
          created_at: at("2026-11-04T09:00:00Z"),
        })
        .execute();
      await addFeedback(db, box, emailId, { at: "2026-11-05T10:00:00Z" });
      const rows = await listMoveCorrections(db, box, at("2026-11-01T00:00:00Z"), { senders: [] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.appliedAt.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    });
  });
});
