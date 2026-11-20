import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { clearReplyTexts } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";
import { createRetentionJob, RETENTION_TEXT_DAYS } from "../../src/retention";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertReplyRequest } from "./reply-fixtures";

// The retention of the reply texts (`reply_requests.instruction`, `sample_body`).
// The period is `RETENTION_TEXT_DAYS` (90) for every organization, counted from `created_at`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const NOW = new Date("2026-11-20T02:40:00Z");
const ago = (days: number, extraMs = 0): Date => new Date(NOW.getTime() - days * DAY_MS - extraMs);
const BEFORE = ago(RETENTION_TEXT_DAYS);

async function newOrg(trx: Trx, retentionDays = 30) {
  const created = await createOrgWithMailbox(trx);
  await trx
    .updateTable("organizations")
    .set({ data_retention_days: retentionDays })
    .where("id", "=", created.orgId)
    .execute();
  return { ctx: { orgId: created.orgId }, ...created };
}

async function request(trx: Trx, org: Awaited<ReturnType<typeof newOrg>>, overrides: Record<string, unknown>) {
  const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
  return insertReplyRequest(trx, org.ctx, org.mailboxId, emailId, {
    trigger: "tap",
    instruction: "Say yes",
    sample_body: "Sample text",
    ...overrides,
  });
}

async function textsOf(trx: Trx, id: string) {
  return trx
    .selectFrom("reply_requests")
    .select(["instruction", "sample_body", "status", "trigger", "thread_key", "updated_at", "created_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

describe("clearReplyTexts", () => {
  test("1. clears the instruction and the sample text of a request older than the window and keeps a newer one", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await request(trx, org, { created_at: ago(91), updated_at: ago(91), status: "done" });
      const young = await request(trx, org, { created_at: ago(89), status: "done" });
      const open = await request(trx, org, { created_at: ago(120), status: "pending" });
      const kept = await textsOf(trx, young);

      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE })).toBe(2);

      const cleared = await textsOf(trx, old);
      expect(cleared).toMatchObject({ instruction: null, sample_body: null, status: "done", trigger: "tap" });
      // The row stays: the code columns and the time of the creation keep their values.
      expect(cleared.thread_key).not.toBe("");
      expect(cleared.created_at.getTime()).toBe(ago(91).getTime());
      // The clearing leaves `updated_at` alone: it is the end time of the request.
      expect(cleared.updated_at.getTime()).toBe(ago(91).getTime());
      expect(await textsOf(trx, open)).toMatchObject({ instruction: null, sample_body: null, status: "pending" });
      expect(await textsOf(trx, young)).toEqual(kept);
      expect(kept).toMatchObject({ instruction: "Say yes", sample_body: "Sample text" });
    });
  });

  test("2. a second run changes nothing, not even updated_at", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await request(trx, org, { created_at: ago(100) });
      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE })).toBe(1);
      const first = await textsOf(trx, old);

      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE })).toBe(0);
      expect(await textsOf(trx, old)).toEqual(first);
    });
  });

  test("the cut-off column is created_at: an old row that was updated now is cleared; a new row with an old updated_at is kept", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const touched = await request(trx, org, { created_at: ago(100), updated_at: NOW });
      const stale = await request(trx, org, { created_at: ago(10), updated_at: ago(200) });

      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE })).toBe(1);
      expect((await textsOf(trx, touched)).instruction).toBeNull();
      expect((await textsOf(trx, stale)).instruction).toBe("Say yes");
    });
  });

  test("a row with only one text is cleared; a row with no text is not counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const onlyInstruction = await request(trx, org, { created_at: ago(95), sample_body: null });
      const onlySample = await request(trx, org, { created_at: ago(95), instruction: null });
      await request(trx, org, { created_at: ago(95), instruction: null, sample_body: null });

      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE })).toBe(2);
      expect(await textsOf(trx, onlyInstruction)).toMatchObject({ instruction: null, sample_body: null });
      expect(await textsOf(trx, onlySample)).toMatchObject({ instruction: null, sample_body: null });
    });
  });

  test("works in batches: 5 rows with a batch of 2", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      for (let index = 0; index < 5; index += 1) await request(trx, org, { created_at: ago(95) });
      expect(await clearReplyTexts(trx, org.ctx, { before: BEFORE, batch: 2 })).toBe(5);
    });
  });

  test("only the rows of the organization of the call", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mine = await request(trx, a, { created_at: ago(95) });
      const theirs = await request(trx, b, { created_at: ago(95) });

      expect(await clearReplyTexts(trx, a.ctx, { before: BEFORE })).toBe(1);
      expect((await textsOf(trx, mine)).instruction).toBeNull();
      expect((await textsOf(trx, theirs)).instruction).toBe("Say yes");
    });
  });
});

describe("clearReplyTexts with two connections", () => {
  test("skips a request that another transaction holds locked, then clears it", async () => {
    const org = await db.transaction().execute(async (trx) => {
      const created = await newOrg(trx);
      return { ...created, id: await request(trx, created, { created_at: ago(100) }) };
    });
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = db.transaction().execute(async (trx) => {
        await trx.selectFrom("reply_requests").select("id").where("id", "=", org.id).forUpdate().execute();
        locked();
        await gate;
      });
      await hasLock;
      expect(await clearReplyTexts(db, org.ctx, { before: BEFORE })).toBe(0);
      release();
      await holder;
      expect(await clearReplyTexts(db, org.ctx, { before: BEFORE })).toBe(1);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
      await db.deleteFrom("users").where("id", "=", org.userId).execute();
    }
  });
});

describe("the retention job and the reply texts (N6)", () => {
  // The day count is the text period (90), never `data_retention_days`: an organization of 30 days and one of 365 days
  // both clear a reply text after 90 days.
  for (const retentionDays of [30, 365]) {
    test(`an organization with data_retention_days = ${retentionDays}: a text of 91 days goes, a text of 89 days stays`, async () => {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx, retentionDays);
        const old = await request(trx, org, { created_at: ago(91) });
        const young = await request(trx, org, { created_at: ago(89) });
        const middle = await request(trx, org, { created_at: ago(45) });

        const counts = await createRetentionJob({ db: trx, now: () => NOW }).runOrg(
          { id: org.orgId, dataRetentionDays: retentionDays },
          NOW
        );

        expect(counts.replyTexts).toBe(1);
        expect((await textsOf(trx, old)).instruction).toBeNull();
        expect((await textsOf(trx, young)).instruction).toBe("Say yes");
        expect((await textsOf(trx, middle)).instruction).toBe("Say yes");
      });
    });
  }
});
