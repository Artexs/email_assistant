import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createPlanned, listActionsForEmail, listSummaries, type PlannedActionInput } from "../../src/modules/actions";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
}

async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId },
  };
}

async function actionRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("actions")
    .select(["id", "org_id", "email_id", "type", "status", "payload", "idempotency_key"])
    .where("org_id", "=", orgId)
    .execute();
}

describe("actions repository", () => {
  test("createPlanned stores the context org and inserts each key once per org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);
      const move: PlannedActionInput = {
        type: "move",
        payload: { folder: "ai_info" },
        status: "logged",
        idempotencyKey: "k-move",
      };
      const items: PlannedActionInput[] = [
        move,
        { type: "save_summary", payload: { summary: "short summary" }, status: "logged", idempotencyKey: "k-summary" },
      ];

      const first = await createPlanned(trx, a.ctx, emailA, items);
      expect(first).toHaveLength(2);
      expect(first.map((row) => [row.type, row.status])).toEqual([
        ["move", "logged"],
        ["save_summary", "logged"],
      ]);

      const rowsA = await actionRows(trx, a.ctx.orgId);
      expect(rowsA).toHaveLength(2);
      expect(rowsA.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
      expect(rowsA.find((row) => row.type === "move")).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailA,
        status: "logged",
        payload: { folder: "ai_info" },
        idempotency_key: "k-move",
      });

      // The same keys again: no insert, no rows returned.
      expect(await createPlanned(trx, a.ctx, emailA, items)).toEqual([]);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      // The key is unique per org: the same key in the other org inserts.
      const inB = await createPlanned(trx, b.ctx, emailB, [move]);
      expect(inB).toHaveLength(1);
      expect(await actionRows(trx, b.ctx.orgId)).toHaveLength(1);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      expect(await createPlanned(trx, a.ctx, emailA, [])).toEqual([]);
    });
  });

  test("listActionsForEmail returns the rows of the context org only", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      await createPlanned(trx, a.ctx, emailA, [
        { type: "move", payload: { folder: "ai_spam" }, status: "ready", idempotencyKey: "l-move" },
        { type: "mark_read", payload: {}, status: "awaiting_approval", idempotencyKey: "l-read" },
      ]);

      const rows = await listActionsForEmail(trx, a.ctx, emailA);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.type === "move")).toMatchObject({
        status: "ready",
        payload: { folder: "ai_spam" },
      });
      expect(rows.find((row) => row.type === "mark_read")).toMatchObject({ status: "awaiting_approval", payload: {} });

      expect(await listActionsForEmail(trx, b.ctx, emailA)).toEqual([]);
    });
  });

  test("listSummaries returns only save_summary payloads of the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA1 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA2 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA3 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);

      await createPlanned(trx, a.ctx, emailA1, [
        { type: "save_summary", payload: { summary: "summary A1" }, status: "logged", idempotencyKey: "s-a1" },
        { type: "move", payload: { folder: "ai_info" }, status: "logged", idempotencyKey: "s-a1-move" },
      ]);
      // A `move` action only: no summary for this email.
      await createPlanned(trx, a.ctx, emailA2, [
        { type: "move", payload: { folder: "ai_notifications" }, status: "logged", idempotencyKey: "s-a2-move" },
      ]);
      await createPlanned(trx, b.ctx, emailB, [
        { type: "save_summary", payload: { summary: "summary B" }, status: "logged", idempotencyKey: "s-b" },
      ]);

      const summaries = await listSummaries(trx, a.ctx, [emailA1, emailA2, emailA3, emailB]);
      expect([...summaries.entries()]).toEqual([[emailA1, "summary A1"]]);

      const otherOrg = await listSummaries(trx, b.ctx, [emailA1, emailB]);
      expect([...otherOrg.entries()]).toEqual([[emailB, "summary B"]]);

      const empty = await listSummaries(trx, a.ctx, []);
      expect(empty.size).toBe(0);
    });
  });
});
