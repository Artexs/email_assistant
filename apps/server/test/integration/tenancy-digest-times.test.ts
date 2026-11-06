import { randomUUID } from "node:crypto";

import { parseDigestTimes } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { createOrganizationWithOwner, getMembership, setDigestTimes } from "../../src/modules/tenancy";

import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("setDigestTimes", () => {
  test("stores the times and reads them back", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrganizationWithOwner(trx, {
        orgName: "Org A",
        timezone: "Europe/Warsaw",
        email: "a@x.test",
        displayName: "Owner A",
      });
      const ctx = { orgId: a.orgId };
      expect(await setDigestTimes(trx, ctx, a.userId, ["08:00", "16:00"])).toBe(true);
      const stored = (await getMembership(trx, ctx, a.userId))?.digest_times;
      expect(stored).toEqual(["08:00:00", "16:00:00"]);
      expect(parseDigestTimes(stored ?? [])).toEqual(["08:00", "16:00"]);

      expect(await setDigestTimes(trx, ctx, a.userId, [])).toBe(true);
      expect((await getMembership(trx, ctx, a.userId))?.digest_times).toEqual([]);
    });
  });

  test("another organization's context changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrganizationWithOwner(trx, {
        orgName: "Org A",
        timezone: "Europe/Warsaw",
        email: "a@x.test",
        displayName: "Owner A",
      });
      const b = await createOrganizationWithOwner(trx, {
        orgName: "Org B",
        timezone: "Europe/Warsaw",
        email: "b@x.test",
        displayName: "Owner B",
      });
      await setDigestTimes(trx, { orgId: a.orgId }, a.userId, ["09:00"]);
      expect(await setDigestTimes(trx, { orgId: b.orgId }, a.userId, ["10:00"])).toBe(false);
      expect(await setDigestTimes(trx, { orgId: randomUUID() }, a.userId, ["10:00"])).toBe(false);
      expect((await getMembership(trx, { orgId: a.orgId }, a.userId))?.digest_times).toEqual(["09:00:00"]);
    });
  });
});
