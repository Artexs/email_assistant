import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { clearLoopTexts } from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

// Retention of the loop texts (step 2): they go 90 days after the loop closed; an open loop keeps them.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const NOW = new Date("2026-11-20T10:00:00Z");
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const BEFORE = ago(90);

async function newOrg(trx: Trx) {
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId }, mailboxId: created.mailboxId };
}

function closedLoop(trx: Trx, org: Awaited<ReturnType<typeof newOrg>>, closedAt: Date, id?: string) {
  return insertLoopRow(trx, org.ctx, org.mailboxId, {
    ...(id === undefined ? {} : { id }),
    status: "closed",
    close_reason: "replied",
    closed_at: closedAt,
    cc_addresses: ["cc@x.test"],
  });
}

async function textsOf(trx: Trx, id: string) {
  return trx
    .selectFrom("open_loops")
    .select([
      "subject",
      "text",
      "to_addresses",
      "cc_addresses",
      "counterpart",
      "texts_cleared_at",
      "thread_key",
      "message_id",
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

describe("clearLoopTexts", () => {
  test("T6: a loop closed 91 days ago is cleared; one closed 89 days ago and an open loop of 120 days are kept; a second run changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await closedLoop(trx, org, ago(91));
      const young = await closedLoop(trx, org, ago(89));
      const open = await insertLoopRow(trx, org.ctx, org.mailboxId, { wait_from_at: ago(120), due_at: ago(115) });
      const keptBefore = await textsOf(trx, young);

      expect(await clearLoopTexts(trx, org.ctx, { before: BEFORE, now: NOW })).toBe(1);

      const cleared = await textsOf(trx, old);
      expect(cleared).toMatchObject({
        subject: null,
        text: null,
        to_addresses: [],
        cc_addresses: [],
        counterpart: null,
      });
      expect(cleared.texts_cleared_at?.getTime()).toBe(NOW.getTime());
      // The thread key and the Message-ID are opaque ids: they stay for the matcher.
      expect(cleared.thread_key).not.toBeNull();
      expect(cleared.message_id).not.toBeNull();
      expect(await textsOf(trx, young)).toEqual(keptBefore);
      expect((await textsOf(trx, open)).subject).not.toBeNull();
      expect((await textsOf(trx, open)).texts_cleared_at).toBeNull();
      expect(await clearLoopTexts(trx, org.ctx, { before: BEFORE, now: NOW })).toBe(0);
    });
  });

  test("a loop closed exactly at the limit is kept", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const edge = await closedLoop(trx, org, BEFORE);

      expect(await clearLoopTexts(trx, org.ctx, { before: BEFORE, now: NOW })).toBe(0);

      expect((await textsOf(trx, edge)).texts_cleared_at).toBeNull();
    });
  });

  test("batches: 5 rows with a batch of 2 are all cleared and counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await closedLoop(trx, org, ago(100 + i)));

      expect(await clearLoopTexts(trx, org.ctx, { before: BEFORE, batch: 2, now: NOW })).toBe(5);

      for (const id of ids) expect((await textsOf(trx, id)).texts_cleared_at).not.toBeNull();
    });
  });

  test("a loop whose texts are already cleared keeps its first clear time", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await closedLoop(trx, org, ago(200));
      await clearLoopTexts(trx, org.ctx, { before: BEFORE, now: ago(100) });

      expect(await clearLoopTexts(trx, org.ctx, { before: BEFORE, now: NOW })).toBe(0);

      expect((await textsOf(trx, id)).texts_cleared_at?.getTime()).toBe(ago(100).getTime());
    });
  });

  test("the run for one organization leaves the old closed loops of another organization alone", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mine = await closedLoop(trx, a, ago(100));
      const theirs = await closedLoop(trx, b, ago(100));

      expect(await clearLoopTexts(trx, a.ctx, { before: BEFORE, now: NOW })).toBe(1);

      expect((await textsOf(trx, mine)).texts_cleared_at).not.toBeNull();
      expect((await textsOf(trx, theirs)).texts_cleared_at).toBeNull();
      expect((await textsOf(trx, theirs)).subject).not.toBeNull();
    });
  });

  // The inner select picks the batch by id. Without its own org filter, a row of another organization with a lower id
  // takes the one slot of the batch; the outer filter then drops it and the run clears nothing.
  test("a batch is filled only with rows of the own organization, whatever the ids of other organizations", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const [lowId, highId] = [randomUUID(), randomUUID()].sort() as [string, string];
      const theirs = await closedLoop(trx, b, ago(100), lowId);
      const mine = await closedLoop(trx, a, ago(100), highId);

      expect(await clearLoopTexts(trx, a.ctx, { before: BEFORE, batch: 1, now: NOW })).toBe(1);

      expect((await textsOf(trx, mine)).texts_cleared_at).not.toBeNull();
      expect((await textsOf(trx, theirs)).texts_cleared_at).toBeNull();
    });
  });
});
