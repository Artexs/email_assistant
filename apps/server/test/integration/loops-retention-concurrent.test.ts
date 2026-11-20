import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { clearLoopTexts } from "../../src/modules/loops";
import type { TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

// The test commits its data and uses two connections: a row lock only shows between two connections.
// It removes its organization and its user in `finally`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T03:00:00Z");
const OLD = new Date(NOW.getTime() - 100 * DAY_MS);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("clearLoopTexts with two connections", () => {
  test("skips a loop that another transaction holds locked, then clears it", async () => {
    const org = await db.transaction().execute(async (trx) => {
      const created = await createOrgWithMailbox(trx);
      const ctx: TenantContext = { orgId: created.orgId };
      const loopId = await insertLoopRow(trx, ctx, created.mailboxId, {
        status: "closed",
        close_reason: "replied",
        closed_at: OLD,
      });
      return { ...created, ctx, loopId };
    });
    try {
      const locked = deferred();
      const release = deferred();
      const holder = db.transaction().execute(async (trx) => {
        await trx.selectFrom("open_loops").select("id").where("id", "=", org.loopId).forUpdate().execute();
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      expect(await clearLoopTexts(db, org.ctx, { before: NOW, now: NOW })).toBe(0);
      release.resolve();
      await holder;
      expect(await clearLoopTexts(db, org.ctx, { before: NOW, now: NOW })).toBe(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
      await db.deleteFrom("users").where("id", "=", org.userId).execute();
    }
  });
});
