import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { clearTrips, insertTrip, queueHistoryCheck } from "../../src/modules/trust";
import { createDb, type Db, type TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb } from "./helpers";
import { insertCheckItemRow, insertCheckRow } from "./trust-fixtures";

// The "exactly one" rules of the trust tables, with two or more connections and committed rows: one open history check
// per mailbox, one trip per grant, one history item per (check, mail), one clear of a trip. The same tests run as the
// `app` role and as the table owner (the owner skips row-level security; the unique keys must hold there too).
// Each test removes its organization and its user in `finally`.
const appDb = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the race tests");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

const GRANTED = new Date("2026-11-10T10:00:00Z");
const T1 = new Date("2026-11-12T11:00:00Z");
const PARALLEL = 8;

class Rollback extends Error {}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface Org extends TenantContext {
  userId: string;
  mailboxId: string;
}

async function withCommittedOrg(conn: Db, run: (org: Org) => Promise<void>): Promise<void> {
  const org = await conn.transaction().execute(async (trx) => {
    const created = await createOrgWithMailbox(trx);
    return { ...created, orgId: created.orgId };
  });
  try {
    await run(org);
  } finally {
    await conn.deleteFrom("organizations").where("id", "=", org.orgId).execute();
    await conn.deleteFrom("users").where("id", "=", org.userId).execute();
  }
}

// True when a session waits for a lock that session `holderPid` holds (the second writer of a unique key waits for the
// transaction of the first). `pg_locks` and `pg_blocking_pids` show the sessions of every role.
async function someoneWaitsFor(holderPid: number): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pg_locks l
    where not l.granted and ${holderPid} = any (pg_blocking_pids(l.pid))`.execute(ownerDb);
  return (rows[0]?.n ?? 0) > 0;
}

async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await someoneWaitsFor(holderPid))) {
    if (Date.now() >= deadline) throw new Error("the second writer never waited for the lock");
    await Bun.sleep(10);
  }
}

// Writer A holds its transaction open after `first`; writer B starts `second` and waits for the key; then A ends.
async function holdThenRace<T>(
  conn: Db,
  first: (trx: Parameters<Parameters<ReturnType<Db["transaction"]>["execute"]>[0]>[0]) => Promise<T>,
  second: (trx: Parameters<Parameters<ReturnType<Db["transaction"]>["execute"]>[0]>[0]) => Promise<T>,
  end: "commit" | "rollback"
): Promise<{ first: T; second: T }> {
  const held = deferred();
  const release = deferred();
  let firstValue: T | undefined;
  let holderPid = 0;
  const writerA = conn
    .transaction()
    .execute(async (trx) => {
      const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      holderPid = pid.rows[0]?.pid ?? 0;
      firstValue = await first(trx);
      held.resolve();
      await release.promise;
      if (end === "rollback") throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  await held.promise;
  const writerB = conn.transaction().execute((trx) => second(trx));
  await waitUntilBlockedBy(holderPid);
  release.resolve();
  await writerA;
  return { first: firstValue as T, second: await writerB };
}

for (const [role, conn] of [
  ["app", appDb],
  ["owner", ownerDb],
] as const) {
  describe(`two connections as the ${role} role`, () => {
    test("queueHistoryCheck: the second caller waits for the first, then finds its check and makes none", async () => {
      await withCommittedOrg(conn, async (org) => {
        const ids = await holdThenRace(
          conn,
          (trx) => queueHistoryCheck(trx, org, org.mailboxId, "connect"),
          (trx) => queueHistoryCheck(trx, org, org.mailboxId, "cli"),
          "commit"
        );
        expect(ids.first).not.toBeNull();
        expect(ids.second).toBeNull();
        const rows = await conn
          .selectFrom("history_checks")
          .select("reason")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(rows).toEqual([{ reason: "connect" }]);
      });
    });

    test("queueHistoryCheck: when the first caller rolls back, the second makes the one check", async () => {
      await withCommittedOrg(conn, async (org) => {
        const ids = await holdThenRace(
          conn,
          (trx) => queueHistoryCheck(trx, org, org.mailboxId, "connect"),
          (trx) => queueHistoryCheck(trx, org, org.mailboxId, "cli"),
          "rollback"
        );
        expect(ids.second).not.toBeNull();
        const rows = await conn
          .selectFrom("history_checks")
          .select("reason")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(rows).toEqual([{ reason: "cli" }]);
      });
    });

    test(`queueHistoryCheck: ${PARALLEL} callers at once make one row, also after a done check`, async () => {
      await withCommittedOrg(conn, async (org) => {
        const opened = await Promise.all(
          Array.from({ length: PARALLEL }, () => queueHistoryCheck(conn, org, org.mailboxId, "web"))
        );
        expect(opened.filter((id) => id !== null)).toHaveLength(1);
        await conn
          .updateTable("history_checks")
          .set({ status: "done", finished_at: T1 })
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        const again = await Promise.all(
          Array.from({ length: PARALLEL }, () => queueHistoryCheck(conn, org, org.mailboxId, "model_switch"))
        );
        expect(again.filter((id) => id !== null)).toHaveLength(1);
        const open = await conn
          .selectFrom("history_checks")
          .select("status")
          .where("mailbox_id", "=", org.mailboxId)
          .where("status", "not in", ["done", "no_result"])
          .execute();
        expect(open).toHaveLength(1);
        const all = await conn
          .selectFrom("history_checks")
          .select("id")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(all).toHaveLength(2);
      });
    });

    test("insertTrip: the second writer of one grant waits, then gets null; one row", async () => {
      await withCommittedOrg(conn, async (org) => {
        const trip = { mailboxId: org.mailboxId, category: "info", grantedAt: GRANTED, counts: {} } as const;
        const ids = await holdThenRace(
          conn,
          (trx) => insertTrip(trx, org, { ...trip, reason: "corrections" }),
          (trx) => insertTrip(trx, org, { ...trip, reason: "important_hidden" }),
          "commit"
        );
        expect(ids.first).not.toBeNull();
        expect(ids.second).toBeNull();
        const rows = await conn
          .selectFrom("autonomy_trips")
          .select("reason")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(rows).toEqual([{ reason: "corrections" }]);
      });
    });

    test(`insertTrip: ${PARALLEL} writers of one grant make one trip`, async () => {
      await withCommittedOrg(conn, async (org) => {
        const ids = await Promise.all(
          Array.from({ length: PARALLEL }, () =>
            conn.transaction().execute((trx) =>
              insertTrip(trx, org, {
                mailboxId: org.mailboxId,
                category: "spam",
                grantedAt: GRANTED,
                reason: "history_fail",
                counts: { moved: 3 },
              })
            )
          )
        );
        expect(ids.filter((id) => id !== null)).toHaveLength(1);
        const rows = await conn
          .selectFrom("autonomy_trips")
          .select("id")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(rows).toHaveLength(1);
      });
    });

    test(`clearTrips: ${PARALLEL} callers clear one active trip once, with the time of the first`, async () => {
      await withCommittedOrg(conn, async (org) => {
        await conn.transaction().execute((trx) =>
          insertTrip(trx, org, {
            mailboxId: org.mailboxId,
            category: "notification",
            grantedAt: GRANTED,
            reason: "corrections",
            counts: {},
          })
        );
        const counts = await Promise.all(
          Array.from({ length: PARALLEL }, (_, n) =>
            conn
              .transaction()
              .execute((trx) => clearTrips(trx, org, org.mailboxId, "notification", new Date(T1.getTime() + n * 1000)))
          )
        );
        expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1);
        const rows = await conn
          .selectFrom("autonomy_trips")
          .select("cleared_at")
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(rows).toHaveLength(1);
        const stamps = Array.from({ length: PARALLEL }, (_, n) => T1.getTime() + n * 1000);
        expect(stamps).toContain(rows[0]?.cleared_at?.getTime() ?? -1);
      });
    });

    test("history item: two writers of one (check, mail) make one row; the other gets a unique error", async () => {
      await withCommittedOrg(conn, async (org) => {
        const { checkId, emailId } = await conn.transaction().execute(async (trx) => ({
          checkId: await insertCheckRow(trx, org, org.mailboxId),
          emailId: await insertTestEmail(trx, org, org.mailboxId),
        }));
        const results = await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            conn.transaction().execute((trx) => insertCheckItemRow(trx, org, checkId, emailId))
          )
        );
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(failed).toHaveLength(3);
        expect(failed.every((r) => (r.reason as { code?: string }).code === "23505")).toBe(true);
        const rows = await conn
          .selectFrom("history_check_items")
          .select("email_id")
          .where("check_id", "=", checkId)
          .execute();
        expect(rows).toHaveLength(1);
      });
    });
  });
}
