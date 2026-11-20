import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { clearSentBodies, clearSentHeaders } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { ago, before30, before90, over30, over90, type Org, newOrg } from "./retention-clear-helpers";

// The retention clears for Sent mail bodies and headers. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// A stored Sent row. `internalDate` decides the retention window; `tag` makes the ids unique and readable.
async function insertSentRow(
  trx: Transaction<DB>,
  org: Org,
  tag: string,
  internalDate: Date,
  id?: string
): Promise<string> {
  const row = await trx
    .insertInto("sent_emails")
    .values({
      ...(id === undefined ? {} : { id }),
      org_id: org.ctx.orgId,
      mailbox_id: org.mailboxId,
      dedup_key: `dedup-${tag}`,
      path: "Sent",
      uidvalidity: "1",
      uid: String(Math.floor(Math.random() * 1_000_000)),
      message_id: `<m-${tag}@x.test>`,
      parent_message_id: `<p-${tag}@x.test>`,
      references_ids: [`<r-${tag}@x.test>`],
      thread_key: `thread-${tag}`,
      from_address: "me@x.test",
      to_addresses: ["to@x.test"],
      cc_addresses: ["cc@x.test"],
      subject: "Subject",
      body_text: "Body text",
      origin: "user",
      content: "stored",
      sent_at: internalDate,
      internal_date: internalDate,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

function readSent(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("sent_emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("clearSentBodies", () => {
  test("clears the text over the period by the Sent date, keeps the row and its content; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      // `created_at` is now for all rows: only `internal_date` decides.
      const over = await insertSentRow(trx, a, "over", over30);
      const under = await insertSentRow(trx, a, "under", ago(29 * DAY_MS));
      const otherOrg = await insertSentRow(trx, b, "b", over30);

      expect(await clearSentBodies(trx, a.ctx, { before: before30 })).toBe(1);

      const cleared = await readSent(trx, over);
      expect(cleared.body_text).toBeNull();
      expect(cleared.content).toBe("stored");
      expect(cleared.subject).toBe("Subject");
      expect((await readSent(trx, under)).body_text).toBe("Body text");
      expect((await readSent(trx, otherOrg)).body_text).toBe("Body text");
      expect(await clearSentBodies(trx, a.ctx, { before: before30 })).toBe(0);
    });
  });

  test("works in batches: batch 1 over 3 rows returns 3", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      for (const tag of ["one", "two", "three"]) await insertSentRow(trx, a, tag, over30);
      expect(await clearSentBodies(trx, a.ctx, { before: before30, batch: 1 })).toBe(3);
    });
  });

  // The inner selection must filter by organization: else its batch fills with the rows of other organizations (and locks them).
  test("batch 1 with an older row of org B that sorts first: org A still clears its row, org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const otherOrg = await insertSentRow(trx, b, "b", over30, "00000000-0000-4000-8000-000000000001");
      const mine = await insertSentRow(trx, a, "a", over30, "ffffffff-ffff-4fff-8fff-ffffffffffff");

      expect(await clearSentBodies(trx, a.ctx, { before: before30, batch: 1 })).toBe(1);

      expect(await readSent(trx, mine)).toMatchObject({ body_text: null });
      expect(await readSent(trx, otherOrg)).toMatchObject({ body_text: "Body text" });
    });
  });
});

describe("clearSentHeaders", () => {
  test("clears subject and addresses over 90 days, keeps the ids and times and at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const over = await insertSentRow(trx, a, "over", over90);
      const under = await insertSentRow(trx, a, "under", ago(89 * DAY_MS));
      const otherOrg = await insertSentRow(trx, b, "b", over90);

      expect(await clearSentHeaders(trx, a.ctx, { before: before90 })).toBe(1);

      const cleared = await readSent(trx, over);
      expect(cleared).toMatchObject({
        subject: null,
        from_address: null,
        to_addresses: [],
        cc_addresses: [],
        references_ids: [],
        message_id: "<m-over@x.test>",
        parent_message_id: "<p-over@x.test>",
        thread_key: "thread-over",
        dedup_key: "dedup-over",
        origin: "user",
        content: "stored",
      });
      expect(cleared.sent_at.getTime()).toBe(over90.getTime());
      expect(cleared.internal_date.getTime()).toBe(over90.getTime());
      expect(await readSent(trx, under)).toMatchObject({ subject: "Subject", to_addresses: ["to@x.test"] });
      expect(await readSent(trx, otherOrg)).toMatchObject({ subject: "Subject", from_address: "me@x.test" });
      expect(await clearSentHeaders(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });

  test("works in batches: batch 1 over 3 rows returns 3", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      for (const tag of ["one", "two", "three"]) await insertSentRow(trx, a, tag, over90);
      expect(await clearSentHeaders(trx, a.ctx, { before: before90, batch: 1 })).toBe(3);
    });
  });

  // The inner selection must filter by organization: else its batch fills with the rows of other organizations (and locks them).
  test("batch 1 with an older row of org B that sorts first: org A still clears its row, org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const otherOrg = await insertSentRow(trx, b, "b", over90, "00000000-0000-4000-8000-000000000001");
      const mine = await insertSentRow(trx, a, "a", over90, "ffffffff-ffff-4fff-8fff-ffffffffffff");

      expect(await clearSentHeaders(trx, a.ctx, { before: before90, batch: 1 })).toBe(1);

      expect(await readSent(trx, mine)).toMatchObject({ subject: null, from_address: null });
      expect(await readSent(trx, otherOrg)).toMatchObject({ subject: "Subject", from_address: "me@x.test" });
    });
  });
});
