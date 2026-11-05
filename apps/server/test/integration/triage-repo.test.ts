import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  insertFeedback,
  insertTriageResult,
  latestTriageResult,
  type TriageResultInput,
} from "../../src/modules/triage";
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
  userId: string;
}

async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId, userId: a.userId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId, userId: b.userId },
  };
}

function resultRow(emailId: string, overrides?: Partial<TriageResultInput>): TriageResultInput {
  return {
    emailId,
    category: "info",
    vip: false,
    confidence: 0.9,
    reasonCode: "llm",
    reason: "newsletter",
    fields: { lang: "pl" },
    model: "gemini-3.5-flash-lite",
    promptVersion: "classifier-v1",
    tokensIn: 120,
    tokensOut: 30,
    latencyMs: 850,
    ...overrides,
  };
}

describe("triage repository", () => {
  test("insertTriageResult stores the context org and fails the foreign key for another org's email", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      const id = await insertTriageResult(trx, a.ctx, resultRow(emailA, { vip: true }));
      const row = await trx.selectFrom("triage_results").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailA,
        category: "info",
        vip: true,
        reason_code: "llm",
        reason: "newsletter",
        fields: { lang: "pl" },
        model: "gemini-3.5-flash-lite",
        prompt_version: "classifier-v1",
        tokens_in: 120,
        tokens_out: 30,
        latency_ms: 850,
      });
      expect(row.confidence).toBeCloseTo(0.9, 5);

      await sql`savepoint cross_org_triage_result`.execute(trx);
      await expect(insertTriageResult(trx, b.ctx, resultRow(emailA))).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_triage_result`.execute(trx);
    });
  });

  test("latestTriageResult returns the newer row, and undefined for another org's context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      // The newer row goes in first, so the insert order cannot decide the result.
      const newer = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailA, { category: "spam", confidence: 0.75, reasonCode: "llm", fields: { n: 2 } })
      );
      const older = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailA, { category: "urgent", reasonCode: "whitelist", model: null })
      );
      await trx
        .updateTable("triage_results")
        .set({ created_at: sql`now() - interval '1 minute'` })
        .where("id", "=", older)
        .execute();

      const latest = await latestTriageResult(trx, a.ctx, emailA);
      expect(latest).toBeDefined();
      expect(latest).toMatchObject({
        id: newer,
        category: "spam",
        reason_code: "llm",
        model: "gemini-3.5-flash-lite",
        fields: { n: 2 },
      });
      expect(latest?.confidence).toBeCloseTo(0.75, 5);

      expect(await latestTriageResult(trx, b.ctx, emailA)).toBeUndefined();
    });
  });

  test("insertFeedback stores NULL for a null true category, the given source, and the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      const rightId = await insertFeedback(trx, a.ctx, {
        emailId: emailA,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });
      const wrongId = await insertFeedback(trx, a.ctx, {
        emailId: emailA,
        verdict: "wrong",
        trueCategory: "needs_reply",
        source: "telegram",
        userId: a.userId,
      });

      const rows = await trx
        .selectFrom("triage_feedback")
        .select(["id", "org_id", "email_id", "verdict", "true_category", "source", "user_id"])
        .where("email_id", "=", emailA)
        .execute();
      expect(rows.find((row) => row.id === rightId)).toEqual({
        id: rightId,
        org_id: a.ctx.orgId,
        email_id: emailA,
        verdict: "right",
        true_category: null,
        source: "cli",
        user_id: null,
      });
      expect(rows.find((row) => row.id === wrongId)).toEqual({
        id: wrongId,
        org_id: a.ctx.orgId,
        email_id: emailA,
        verdict: "wrong",
        true_category: "needs_reply",
        source: "telegram",
        user_id: a.userId,
      });

      await sql`savepoint cross_org_feedback`.execute(trx);
      await expect(
        insertFeedback(trx, b.ctx, {
          emailId: emailA,
          verdict: "right",
          trueCategory: null,
          source: "web",
          userId: null,
        })
      ).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_feedback`.execute(trx);
    });
  });
});
