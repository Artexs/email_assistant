import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  claimNextCheck,
  endCheck,
  failStep,
  markBackfilled,
  markStatus,
  queueFlagOnCheck,
  releaseCheck,
  HISTORY_LOCK_STALE_MS,
  HISTORY_RETRY_MS,
  queueHistoryCheck,
  type ClaimedCheck,
} from "../../src/modules/trust";
import { createDb, withTenantScope, type Db } from "../../src/platform/db";

import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import { checkRows, jobOf, RUNNING_KEY, theCheck, withHistoryBox, type HistoryBox } from "./trust-history-helpers";

// The "exactly one / once / only" rules of the history job, with two or more connections and committed rows: one claim of a check,
// one take-back of a stale lock, a write only by the holder of the lock, one `flag_on` check per mailbox, one backfill per check.
// The same tests run as the `app` role and as the table owner (the owner skips row-level security; the locks and the unique
// index must hold there too). The row-level security of the queue is tested as the `app` role only.
const appDb = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the race tests");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

const PARALLEL = 8;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// True when a session waits for a lock that session `holderPid` holds. `pg_locks` and `pg_blocking_pids` show the sessions of every role.
async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_locks l
      where not l.granted and ${holderPid} = any (pg_blocking_pids(l.pid))`.execute(ownerDb);
    if ((rows[0]?.n ?? 0) > 0) return;
    if (Date.now() >= deadline) throw new Error("the second queue call never waited for the lock");
    await Bun.sleep(10);
  }
}

async function queue(box: HistoryBox): Promise<string> {
  const id = await queueHistoryCheck(appDb, box, box.mailboxId, "connect");
  if (id === null) throw new Error("check not queued");
  return id;
}

async function claimed(conn: Db, box: HistoryBox): Promise<ClaimedCheck> {
  const claim = await claimNextCheck(conn, box, box.clock.now);
  if (claim.kind !== "claimed") throw new Error(`expected a claim, got ${claim.kind}`);
  return claim.check;
}

const later = (box: HistoryBox, ms: number): Date => new Date(box.clock.now.getTime() + ms);

for (const [role, conn] of [
  ["app role", appDb],
  ["table owner", ownerDb],
] as const) {
  describe(`${role}: two connections, committed rows`, () => {
    test("one due check: of 8 claims at once exactly one wins; the lock is set and no window yet", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        await queue(box);
        const results = await Promise.all(
          Array.from({ length: PARALLEL }, () => claimNextCheck(conn, box, box.clock.now))
        );
        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
        expect(results.filter((result) => result.kind === "none")).toHaveLength(PARALLEL - 1);
        const row = await theCheck(appDb, box);
        expect(row.locked_at?.getTime()).toBe(box.clock.now.getTime());
        expect(row.attempts).toBe(0);
        expect(row.window_start).toBeNull();
        // The claim does not move the status: the step does.
        expect(row.status).toBe("queued");
      });
    });

    test("TG3. two due checks in one organization: the oldest next_attempt_at is claimed first", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const second = await appDb.transaction().execute((trx) => addMailbox(trx, box));
        const first = await queue(box);
        const other = await queueHistoryCheck(appDb, box, second, "connect");
        if (other === null) throw new Error("second check not queued");
        await appDb
          .updateTable("history_checks")
          .set({ next_attempt_at: later(box, -2 * MINUTE_MS) })
          .where("id", "=", other)
          .execute();
        await appDb
          .updateTable("history_checks")
          .set({ next_attempt_at: later(box, -MINUTE_MS) })
          .where("id", "=", first)
          .execute();
        const one = await claimNextCheck(conn, box, box.clock.now);
        expect(one.kind === "claimed" ? one.check.id : null).toBe(other);
        const two = await claimNextCheck(conn, box, box.clock.now);
        expect(two.kind === "claimed" ? two.check.id : null).toBe(first);
      });
    });

    test("a row that another claim holds is skipped, not waited for (SKIP LOCKED)", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const id = await queue(box);
        const held = deferred();
        const release = deferred();
        const holder = conn.transaction().execute(async (trx) => {
          await trx.selectFrom("history_checks").select("id").where("id", "=", id).forUpdate().execute();
          held.resolve();
          await release.promise;
        });
        await held.promise;
        try {
          // The holder keeps its row lock while this claim runs: a waiting claim would never end before the release.
          const claim = await Promise.race([
            claimNextCheck(conn, box, box.clock.now),
            Bun.sleep(3000).then(() => "waited" as const),
          ]);
          expect(claim).toEqual({ kind: "none" });
        } finally {
          release.resolve();
          await holder;
        }
        expect((await claimNextCheck(conn, box, box.clock.now)).kind).toBe("claimed");
      });
    });

    test("a stale lock: of 8 take-backs at once exactly one wins and it counts exactly one attempt", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const id = await queue(box);
        await appDb
          .updateTable("history_checks")
          .set({ locked_at: later(box, -(HISTORY_LOCK_STALE_MS + MINUTE_MS)), attempts: 1 })
          .where("id", "=", id)
          .execute();
        const results = await Promise.all(
          Array.from({ length: PARALLEL }, () => claimNextCheck(conn, box, box.clock.now))
        );
        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
        expect((await theCheck(appDb, box)).attempts).toBe(2);
      });
    });

    test("the take-back that is the third attempt stops the check once", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const id = await queue(box);
        await appDb
          .updateTable("history_checks")
          .set({ locked_at: later(box, -(HISTORY_LOCK_STALE_MS + MINUTE_MS)), attempts: 2, status: "backfilling" })
          .where("id", "=", id)
          .execute();
        const results = await Promise.all(
          Array.from({ length: PARALLEL }, () => claimNextCheck(conn, box, box.clock.now))
        );
        expect(results.filter((result) => result.kind === "stopped")).toHaveLength(1);
        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(0);
        expect(await theCheck(appDb, box)).toMatchObject({
          status: "no_result",
          no_result_reason: "stopped",
          attempts: 3,
        });
      });
    });

    test("only the holder of the lock writes: a run whose lock was taken back changes nothing", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        await queue(box);
        const first = await claimed(conn, box);
        // Eleven minutes later a second run takes the stale lock back.
        box.clock.now = later(box, HISTORY_LOCK_STALE_MS + MINUTE_MS);
        const second = await claimed(conn, box);
        expect(second.attempts).toBe(1);
        const before = await theCheck(appDb, box);

        // Every write of the first run is refused; the check is as the second run claimed it.
        expect(await markStatus(conn, box, first, "backfilling")).toBe(false);
        expect(
          await markBackfilled(conn, box, first, { at: box.clock.now, windowStart: box.clock.now, key: RUNNING_KEY })
        ).toBe(false);
        expect(await releaseCheck(conn, box, first, { at: box.clock.now, status: "classifying" })).toBe(false);
        expect(await endCheck(conn, box, first, "no_history", box.clock.now)).toBe(false);
        expect(await failStep(conn, box, first, box.clock.now)).toBeNull();
        expect(await theCheck(appDb, box)).toEqual(before);

        // The second run writes.
        expect(await markStatus(conn, box, second, "backfilling")).toBe(true);
        expect(await releaseCheck(conn, box, second, { at: later(box, HISTORY_RETRY_MS) })).toBe(true);
        expect(await theCheck(appDb, box)).toMatchObject({ status: "backfilling", attempts: 1, locked_at: null });
      });
    });

    test("a write after the check ended changes nothing", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        await queue(box);
        const claim = await claimed(conn, box);
        expect(await endCheck(conn, box, claim, "no_history", box.clock.now)).toBe(true);
        expect(await releaseCheck(conn, box, claim, { at: box.clock.now, status: "classifying" })).toBe(false);
        expect(await failStep(conn, box, claim, box.clock.now)).toBeNull();
        expect(await theCheck(appDb, box)).toMatchObject({
          status: "no_result",
          no_result_reason: "no_history",
          attempts: 0,
        });
      });
    });

    test("a check that is not due is not claimed, and a check that ended by another path is not changed by a step", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const id = await queue(box);
        await appDb
          .updateTable("history_checks")
          .set({ next_attempt_at: later(box, MINUTE_MS) })
          .where("id", "=", id)
          .execute();
        expect(await claimNextCheck(conn, box, box.clock.now)).toEqual({ kind: "none" });
        await appDb
          .updateTable("history_checks")
          .set({ next_attempt_at: box.clock.now })
          .where("id", "=", id)
          .execute();
        const claim = await claimed(conn, box);
        // Another path ends the check (an operator) but leaves the lock: the step may not write over the end.
        await appDb
          .updateTable("history_checks")
          .set({ status: "done", finished_at: box.clock.now })
          .where("id", "=", id)
          .execute();
        expect(await releaseCheck(conn, box, claim, { at: box.clock.now, status: "classifying" })).toBe(false);
        expect(await markStatus(conn, box, claim, "backfilling")).toBe(false);
        expect(await failStep(conn, box, claim, box.clock.now)).toBeNull();
        expect(await theCheck(appDb, box)).toMatchObject({ status: "done", attempts: 0 });
      });
    });

    test("a failed step and a take-back at once: exactly one applies and the row counts one attempt", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        await queue(box);
        const first = await claimed(conn, box);
        box.clock.now = later(box, HISTORY_LOCK_STALE_MS + MINUTE_MS);
        const [failed, taken] = await Promise.all([
          failStep(conn, box, first, box.clock.now),
          claimNextCheck(conn, box, box.clock.now),
        ]);
        // Whichever order the two took, exactly one of them applies: the lock of the first run is gone after a take-back,
        // and after a failed step the retry is not due. One attempt in the row.
        const applied = (failed === null ? 0 : 1) + (taken.kind === "claimed" ? 1 : 0);
        expect(applied).toBe(1);
        expect((await theCheck(appDb, box)).attempts).toBe(1);
      });
    });

    test("flag_on: of 8 queue calls at once exactly one makes a row; after the check ended none makes a second", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const results = await Promise.all(
          Array.from({ length: PARALLEL }, () => queueFlagOnCheck(conn, box, box.mailboxId))
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        const rows = await checkRows(appDb, box);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.reason).toBe("flag_on");

        await appDb
          .updateTable("history_checks")
          .set({ status: "no_result", no_result_reason: "no_history", finished_at: box.clock.now })
          .where("mailbox_id", "=", box.mailboxId)
          .execute();
        const again = await Promise.all(
          Array.from({ length: PARALLEL }, () => queueFlagOnCheck(conn, box, box.mailboxId))
        );
        expect(again.filter(Boolean)).toHaveLength(0);
        expect(await checkRows(appDb, box)).toHaveLength(1);
      });
    });

    test("flag_on: a queue call that waits for the mailbox lock sees the check that the holder made meanwhile", async () => {
      await withHistoryBox(appDb, { mails: 0 }, async (box) => {
        const held = deferred<number>();
        const release = deferred();
        // The holder is an earlier flag_on run: it holds the mailbox lock, makes its check, the check ends, then it commits.
        const holder = conn.transaction().execute(async (trx) => {
          await trx.selectFrom("mailboxes").select("id").where("id", "=", box.mailboxId).forUpdate().execute();
          const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
          held.resolve(rows[0]?.pid ?? 0);
          await release.promise;
          await trx
            .insertInto("history_checks")
            .values({
              org_id: box.orgId,
              mailbox_id: box.mailboxId,
              reason: "flag_on",
              status: "no_result",
              no_result_reason: "no_history",
              finished_at: box.clock.now,
            })
            .execute();
        });
        const holderPid = await held.promise;
        const second = queueFlagOnCheck(conn, box, box.mailboxId);
        try {
          // The second call waits for the mailbox lock: it does not read the checks before the holder ends.
          await waitUntilBlockedBy(holderPid);
        } finally {
          release.resolve();
          await holder;
        }
        expect(await second).toBe(false);
        expect(await checkRows(appDb, box)).toHaveLength(1);
      });
    });

    test("two job runs at once on one queued check: exactly one reads the mailbox and one advances the check", async () => {
      await withHistoryBox(appDb, {}, async (box) => {
        await queue(box);
        await Promise.all([jobOf(conn, box).run(), jobOf(conn, box).run()]);
        expect(box.opens.count).toBe(2); // one login for the backfill, one for the flag refresh: both of the one run
        const row = await theCheck(appDb, box);
        expect(row).toMatchObject({ status: "waiting_flags", attempts: 0 });
        const mails = await appDb.selectFrom("emails").select("id").where("mailbox_id", "=", box.mailboxId).execute();
        expect(mails).toHaveLength(5);
      });
    });
  });
}

describe("row-level security of the queue (app role)", () => {
  test("a claim in the scope of another organization finds nothing, and its writes change nothing", async () => {
    await withHistoryBox(appDb, { mails: 0 }, async (boxA) => {
      await withHistoryBox(appDb, { mails: 0 }, async (boxB) => {
        await queue(boxA);
        await queue(boxB);
        // The code filter names org B, the scope is org A: the policy hides the rows of B, so B's check is not claimed.
        const crossed = await withTenantScope(boxA.orgId, () => claimNextCheck(appDb, boxB, boxB.clock.now));
        expect(crossed).toEqual({ kind: "none" });
        expect(await theCheck(appDb, boxB)).toMatchObject({ locked_at: null, attempts: 0 });

        // In its own scope each organization claims its own check only.
        const own = await withTenantScope(boxA.orgId, () => claimNextCheck(appDb, boxA, boxA.clock.now));
        expect(own.kind).toBe("claimed");
        if (own.kind !== "claimed") return;
        expect(own.check.mailboxId).toBe(boxA.mailboxId);
        expect(await theCheck(appDb, boxB)).toMatchObject({ locked_at: null });

        // A claim of A used with the context of B writes nothing of B's.
        const inB = await withTenantScope(boxB.orgId, () =>
          releaseCheck(appDb, boxB, own.check, { at: boxA.clock.now })
        );
        expect(inB).toBe(false);
        expect(await theCheck(appDb, boxA)).toMatchObject({ status: "queued" });
        expect((await theCheck(appDb, boxA)).locked_at).not.toBeNull();
      });
    });
  });

  test("with no scope the claim of one organization still takes only its own check, also when another organization's is older", async () => {
    await withHistoryBox(appDb, { mails: 0 }, async (boxA) => {
      await withHistoryBox(appDb, { mails: 0 }, async (boxB) => {
        // B's check is older than A's: a claim without the organization filter would take B's.
        await queue(boxB);
        await queue(boxA);
        const claim = await claimNextCheck(appDb, boxA, boxA.clock.now);
        expect(claim.kind).toBe("claimed");
        if (claim.kind === "claimed") expect(claim.check.mailboxId).toBe(boxA.mailboxId);
        expect(await theCheck(appDb, boxB)).toMatchObject({ locked_at: null });
      });
    });
  });

  test("the flag_on queue writes for the organization of the scope only", async () => {
    await withHistoryBox(appDb, { mails: 0 }, async (boxA) => {
      await withHistoryBox(appDb, { mails: 0 }, async (boxB) => {
        const crossed = await withTenantScope(boxA.orgId, () => queueFlagOnCheck(appDb, boxB, boxB.mailboxId));
        expect(crossed).toBe(false);
        expect(await checkRows(appDb, boxB)).toEqual([]);
        expect(await withTenantScope(boxA.orgId, () => queueFlagOnCheck(appDb, boxA, boxA.mailboxId))).toBe(true);
      });
    });
  });
});
