import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { configureMailHosts, type LookupAll } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { countSyncTargets, insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";

import { pauseOtherMailboxes, suspendOrg, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addBox, type Box, emailCount, jobFor, mailboxRow, NOW, type Opened, openers, seed } from "./mail-jobs-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("suspended organizations", () => {
  test("a sync run opens the provider of the active organization only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      await suspendOrg(trx, b.orgId);
      const o = openers();
      for (const box of [a, b]) {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
        o.fakes.set(box.address, fake);
      }

      await jobFor(trx, o).run();

      expect(o.opened).toHaveLength(1);
      expect(o.opened[0]).toBe(o.fakes.get(a.address) as FakeMailProvider);
      expect((await mailboxRow(trx, a.mailboxId)).last_synced_at).toEqual(NOW);
      expect((await mailboxRow(trx, b.mailboxId)).last_synced_at).toBeNull();
      expect(await emailCount(trx, b.mailboxId)).toBe(0);
    });
  });

  test("countSyncTargets counts active mailboxes of organizations that are not suspended", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      // A second mailbox of A, paused.
      const pausedId = randomUUID();
      await insertMailbox(
        trx,
        { orgId: a.orgId },
        {
          id: pausedId,
          address: `paused-${randomUUID()}@x.test`,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: {},
        }
      );
      await setMailboxStatus(trx, { orgId: a.orgId }, pausedId, "paused", NOW);
      await suspendOrg(trx, b.orgId);
      expect(await countSyncTargets(trx)).toEqual({ mailboxes: 1, organizations: 1 });
    });
  });

  describe("the host re-check at the start of a run", () => {
    // The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
    afterEach(() => {
      configureMailHosts({ allowLocal: true });
    });

    function lookupAnswering(address: string): LookupAll {
      return async () => [{ address, family: 4 }];
    }

    function deliverOne(o: Opened, box: Box): FakeMailProvider {
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      o.fakes.set(box.address, fake);
      return fake;
    }

    test("a blocked mailbox whose hosts now pass is active again, and the same run syncs it", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("93.184.216.34") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("active");
        expect(row.status_changed_at).toEqual(NOW);
        expect(row.last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
      });
    });

    test("a blocked mailbox whose host the guard still refuses stays blocked and is not opened", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("10.0.0.7") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("host_blocked");
        expect(row.last_synced_at).toBeNull();
        expect(o.opened).toHaveLength(0);
      });
    });

    test("an active mailbox syncs as before: the re-check lists no row and the fake opener calls no guard", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("10.0.0.7") });

        await jobFor(trx, o).run();

        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
        expect((await mailboxRow(trx, box.mailboxId)).status).toBe("active");
      });
    });

    test("a re-check that fails does not stop the sync of the active mailboxes", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        const o = openers();
        deliverOne(o, box);
        // The first read of the run (the list of blocked mailboxes) fails; the sync list works.
        let failedOnce = false;
        const flaky = new Proxy(trx, {
          get(target, prop) {
            if (prop === "selectFrom" && !failedOnce) {
              failedOnce = true;
              return () => {
                throw new Error("boom");
              };
            }
            const value = Reflect.get(target, prop, target) as unknown;
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
        const errors = spyOn(console, "error").mockImplementation(() => undefined);
        try {
          await jobFor(flaky, o).run();
        } finally {
          errors.mockRestore();
        }

        expect(failedOnce).toBe(true);
        expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
        expect(o.opened).toHaveLength(1);
      });
    });

    test("a suspended organization keeps its blocked mailbox: no guard call, no change", async () => {
      await withRollback(db, async (trx) => {
        const box = await addBox(trx);
        await setMailboxStatus(
          trx,
          { orgId: box.orgId },
          box.mailboxId,
          "host_blocked",
          new Date(NOW.getTime() - HOUR_MS)
        );
        await suspendOrg(trx, box.orgId);
        const o = openers();
        deliverOne(o, box);
        configureMailHosts({ allowLocal: false, lookup: lookupAnswering("93.184.216.34") });

        await jobFor(trx, o).run();

        const row = await mailboxRow(trx, box.mailboxId);
        expect(row.status).toBe("host_blocked");
        expect(row.last_synced_at).toBeNull();
        expect(o.opened).toHaveLength(0);
      });
    });
  });
});
