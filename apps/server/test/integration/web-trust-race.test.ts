import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { lockMailboxSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { configureFeatures } from "../../src/modules/tenancy";
import { turnOnRecommended } from "../../src/modules/trust";

import { testDb } from "./helpers";
import {
  addDoneCheck,
  auditOf,
  gateFile,
  gateOf,
  KEY,
  NOW,
  policyOf,
  trustWebBox,
  type TrustWebBox,
} from "./web-trust-kit";

// "Turn on recommended" under concurrency: the evidence is read after the `FOR UPDATE` lock of the settings row,
// so a tap that waits for another writer reads that writer's commit. Committed rows on several connections of the pool.
const db = testDb();
let box: TrustWebBox;

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await trustWebBox(db);
});
afterEach(async () => {
  await box.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const deps = () => ({
  settings: settingsDeps(db, () => NOW, gateOf(gateFile({ info: 0.8, notification: 0.9, spam: 0.95 }))),
  testMail: NO_TEST_SENDERS,
});

// True when a session waits for a lock that session `holderPid` holds.
async function someoneWaitsFor(holderPid: number): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from pg_locks l
    where not l.granted and ${holderPid} = any (pg_blocking_pids(l.pid))`.execute(db);
  return (rows[0]?.n ?? 0) > 0;
}

async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await someoneWaitsFor(holderPid))) {
    if (Date.now() >= deadline) throw new Error("the tap never waited for the settings lock");
    await Bun.sleep(10);
  }
}

describe("turnOnRecommended under concurrency", () => {
  test("8: four taps at once turn each category on once: one turned_on, three nothing_recommended, three audit rows", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "pass", spam: "fail" });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        turnOnRecommended(deps(), { orgId: box.org.orgId }, box.mailboxId, { actor: box.org.ownerId })
      )
    );
    expect(results.map((result) => result.kind).sort()).toEqual([
      "nothing_recommended",
      "nothing_recommended",
      "nothing_recommended",
      "turned_on",
    ]);
    expect((await auditOf(db, box.org.orgId)).map((row) => row.event)).toEqual([
      "mailbox.mode_changed",
      "mailbox.policy_changed",
      "mailbox.policy_changed",
    ]);
  });

  test("8: a tap that waits for the settings lock reads the commit of the writer that held it", async () => {
    await addDoneCheck(db, box.org.orgId, box.mailboxId, { info: "pass", notification: "fail", spam: "fail" });
    const ctx = { orgId: box.org.orgId };
    let holderPid = 0;
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    let locked!: () => void;
    const holding = new Promise<void>((done) => (locked = done));
    const holder = db.transaction().execute(async (trx) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      holderPid = rows[0]?.pid ?? 0;
      await lockMailboxSettings(trx, ctx, box.mailboxId);
      locked();
      await released;
      // The user turns `info` on by hand while the tap waits.
      await trx
        .updateTable("mailbox_settings")
        .set({
          mode: "assist",
          category_policy: JSON.stringify({
            info: { auto: true, threshold: 0.8, grant: { key: KEY, by: "evidence", at: "2026-11-17T11:00:00.000Z" } },
          }),
        })
        .where("mailbox_id", "=", box.mailboxId)
        .execute();
    });
    await holding;
    const tap = turnOnRecommended(deps(), ctx, box.mailboxId, { actor: box.org.ownerId });
    await waitUntilBlockedBy(holderPid);
    release();
    await holder;
    expect(await tap).toEqual({ kind: "nothing_recommended" });
    // The hand-made grant stays as it is: no second grant, no audit row of the tap.
    expect((await policyOf(db, box.mailboxId)).policy.info?.grant).toMatchObject({ by: "evidence" });
    expect(await auditOf(db, box.org.orgId)).toEqual([]);
  });
});
