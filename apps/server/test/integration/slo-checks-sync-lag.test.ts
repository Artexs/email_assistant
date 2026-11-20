import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { checkSyncLag } from "../../src/modules/operator";

import { resumeOrg, suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import { cfg, at, NOW, STARTED, makeInRollback, setMailbox, orgWithMailbox } from "./slo-checks-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const inRollback = makeInRollback(db);

describe("sync lag", () => {
  test("1. last sync 09:44, status change 08:00: firing, 16 minutes", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check).toEqual({
        kind: "slo_sync_lag",
        state: "firing",
        facts: { mailboxes: 1, max_lag_min: 16 },
      });
      expect(reading.ids).toEqual([org.mailboxId]);
    });
  });

  test("1b. a lag of exactly 15 minutes is not late", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:45") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("2. a status change at 09:50 gives the sync time: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44"), status_changed_at: at("09:50") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("2b. an organization resume at 09:50 gives the sync time: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      await resumeOrg(trx, org.orgId, at("09:50"));
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
      await resumeOrg(trx, org.orgId, at("09:30"));
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("firing");
    });
  });

  test("2c. a paused mailbox is not late", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:00"), status: "paused" });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
    });
  });

  test("3. a lagging mailbox of a suspended organization only: clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:00") });
      await suspendOrg(trx, org.orgId);
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.state).toBe("clear");
      expect(reading.ids).toEqual([]);
    });
  });

  test("4. never synced: created 09:50 is clear, created 09:40 is firing", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { created_at: at("09:50") });
      expect((await checkSyncLag(trx, NOW, cfg, STARTED)).check.state).toBe("clear");
      await setMailbox(trx, org.mailboxId, { created_at: at("09:40") });
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.max_lag_min).toBe(20);
    });
  });

  test("5. within 10 minutes of the start: between, also with a clear DB", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:44") });
      expect((await checkSyncLag(trx, NOW, cfg, at("09:55"))).check.state).toBe("between");
      expect((await checkSyncLag(trx, NOW, cfg, at("09:50"))).check.state).toBe("firing");
      await setMailbox(trx, org.mailboxId, { last_synced_at: at("09:59") });
      expect((await checkSyncLag(trx, NOW, cfg, at("09:55"))).check.state).toBe("between");
    });
  });

  test("shows at most 5 mailbox ids, sorted (the oldest lag belongs to the largest id)", async () => {
    await inRollback(async (trx) => {
      const mailboxIds: string[] = [];
      for (let i = 0; i < 7; i += 1) mailboxIds.push((await orgWithMailbox(trx)).mailboxId);
      mailboxIds.sort();
      // The query orders by lag, oldest first: that is the reverse of the id order here.
      for (const [index, mailboxId] of mailboxIds.entries()) {
        await setMailbox(trx, mailboxId, { last_synced_at: new Date(at("09:00").getTime() - index * MINUTE_MS) });
      }
      const reading = await checkSyncLag(trx, NOW, cfg, STARTED);
      expect(reading.check.facts.mailboxes).toBe(7);
      expect(reading.ids).toEqual(mailboxIds.slice(0, 5));
    });
  });
});
