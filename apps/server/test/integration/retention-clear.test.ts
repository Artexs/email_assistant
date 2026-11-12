import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { clearMailBodies, clearMailHeaders } from "../../src/modules/mail";
import { clearTriageTexts } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-12T03:00:00Z");
const DAY_MS = 24 * 3_600_000;
const ago = (ms: number): Date => new Date(now.getTime() - ms);
const before30 = ago(30 * DAY_MS);
const before90 = ago(90 * DAY_MS);
const pendingBefore = ago(7 * DAY_MS);
const over30 = ago(30 * DAY_MS + 1000);
const over90 = ago(90 * DAY_MS + 1000);

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

function bodyRow(status: string, createdAt: Date) {
  return { status, created_at: createdAt, body_text: "Body text" };
}

async function bodies(trx: Transaction<DB>, ids: string[]): Promise<(string | null)[]> {
  const rows = await trx.selectFrom("emails").select(["id", "body_text"]).where("id", "in", ids).execute();
  const byId = new Map(rows.map((row) => [row.id, row.body_text]));
  return ids.map((id) => byId.get(id) ?? null);
}

// The same rows in org A (the subject) and org B (must never change).
async function seedBodies(trx: Transaction<DB>, org: Org) {
  return {
    doneOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("done", over30)),
    doneAt: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("done", before30)),
    processingOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("processing", over30)),
    pendingOver: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("pending", over30)),
    pendingNew: await insertTestEmail(trx, org.ctx, org.mailboxId, bodyRow("pending", ago(3 * DAY_MS))),
  };
}

describe("clearMailBodies", () => {
  test("clears done and old pending mail, keeps processing, at-limit and newer pending mail; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const rowsA = await seedBodies(trx, a);
      const rowsB = await seedBodies(trx, b);

      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(2);

      expect(await bodies(trx, Object.values(rowsA))).toEqual([null, "Body text", "Body text", null, "Body text"]);
      expect(await bodies(trx, Object.values(rowsB))).toEqual(Array(5).fill("Body text"));
      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(0);

      // A pending mail newer than `pendingBefore` stays even when `before` has passed it.
      expect(await clearMailBodies(trx, a.ctx, { before: ago(1 * DAY_MS), pendingBefore })).toBe(1);
      expect(await bodies(trx, [rowsA.doneAt, rowsA.pendingNew, rowsA.processingOver])).toEqual([
        null,
        "Body text",
        "Body text",
      ]);
    });
  });

  test("has no filter on the mailbox status or the plan: paused mailbox and suspended organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const c = await newOrg(trx);
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", a.mailboxId).execute();
      await suspendOrg(trx, c.ctx.orgId);
      const inPaused = await insertTestEmail(trx, a.ctx, a.mailboxId, bodyRow("pending", over30));
      const inSuspended = await insertTestEmail(trx, c.ctx, c.mailboxId, bodyRow("pending", over30));

      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore })).toBe(1);
      expect(await clearMailBodies(trx, c.ctx, { before: before30, pendingBefore })).toBe(1);
      expect(await bodies(trx, [inPaused, inSuspended])).toEqual([null, null]);
    });
  });

  test("works in batches: batch 2 over 5 rows returns 5", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await insertTestEmail(trx, a.ctx, a.mailboxId, bodyRow("done", over30)));
      }
      expect(await clearMailBodies(trx, a.ctx, { before: before30, pendingBefore, batch: 2 })).toBe(5);
      expect(await bodies(trx, ids)).toEqual(Array(5).fill(null));
    });
  });
});

describe("clearMailHeaders", () => {
  function headerRow(createdAt: Date, tag: string) {
    return {
      created_at: createdAt,
      status: "done",
      subject: "Subject",
      from_address: "from@x.test",
      to_addresses: ["to@x.test"],
      cc_addresses: ["cc@x.test"],
      in_reply_to: "<in@x.test>",
      references_header: "<ref@x.test>",
      message_id_header: `<m-${tag}@x.test>`,
      dedup_key: `dedup-${tag}`,
      thread_key: `thread-${tag}`,
      content_hash: `hash-${tag}`,
      received_at: createdAt,
    };
  }

  test("clears the header columns over 90 days, keeps the technical ids and at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const over = await insertTestEmail(trx, a.ctx, a.mailboxId, headerRow(over90, "over"));
      const at = await insertTestEmail(trx, a.ctx, a.mailboxId, headerRow(before90, "at"));
      const otherOrg = await insertTestEmail(trx, b.ctx, b.mailboxId, headerRow(over90, "b"));

      expect(await clearMailHeaders(trx, a.ctx, { before: before90 })).toBe(1);

      const read = (id: string) =>
        trx
          .selectFrom("emails")
          .select([
            "subject",
            "from_address",
            "to_addresses",
            "cc_addresses",
            "in_reply_to",
            "references_header",
            "message_id_header",
            "dedup_key",
            "thread_key",
            "content_hash",
            "received_at",
            "status",
          ])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
      expect(await read(over)).toEqual({
        subject: null,
        from_address: null,
        to_addresses: [],
        cc_addresses: [],
        in_reply_to: null,
        references_header: null,
        message_id_header: "<m-over@x.test>",
        dedup_key: "dedup-over",
        thread_key: "thread-over",
        content_hash: "hash-over",
        received_at: over90,
        status: "done",
      });
      expect(await read(at)).toMatchObject({ subject: "Subject", to_addresses: ["to@x.test"] });
      expect(await read(otherOrg)).toMatchObject({ subject: "Subject", from_address: "from@x.test" });
      expect(await clearMailHeaders(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("clearTriageTexts", () => {
  test("clears reason and fields over 90 days, keeps the rest and at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const text = { reason: "Because", fields: { amount: "5" }, category: "info" as const };
      const over = await insertTriaged(trx, a.ctx, a.mailboxId, { ...text, createdAt: over90, reasonCode: "vip" });
      const at = await insertTriaged(trx, a.ctx, a.mailboxId, { ...text, createdAt: before90 });
      const other = await insertTriaged(trx, b.ctx, b.mailboxId, { ...text, createdAt: over90 });

      expect(await clearTriageTexts(trx, a.ctx, { before: before90 })).toBe(1);

      const read = (emailId: string) =>
        trx
          .selectFrom("triage_results")
          .select(["reason", "fields", "category", "confidence", "reason_code"])
          .where("email_id", "=", emailId)
          .executeTakeFirstOrThrow();
      expect(await read(over)).toEqual({
        reason: null,
        fields: {},
        category: "info",
        confidence: 0.9,
        reason_code: "vip",
      });
      expect(await read(at)).toMatchObject({ reason: "Because", fields: { amount: "5" } });
      expect(await read(other)).toMatchObject({ reason: "Because", fields: { amount: "5" } });
      expect(await clearTriageTexts(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("retention_indexes migration", () => {
  test("creates the three indexes", async () => {
    const result = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('outbox_email_idx', 'outbox_digest_idx', 'emails_org_created_idx')
    `.execute(db);
    expect(result.rows).toHaveLength(3);
  });
});
