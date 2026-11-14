import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createPlanned } from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertTriageResult, listForLabeling, recordFeedback } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function createTriagedEmail(
  trx: Transaction<DB>,
  tenant: { orgId: string; mailboxId: string },
  overrides?: { category?: "info" | "spam" | "unsure"; messageId?: string | null; fields?: Record<string, unknown> }
): Promise<string> {
  const emailId = await insertTestEmail(trx, { orgId: tenant.orgId }, tenant.mailboxId, {
    message_id_header: overrides?.messageId === undefined ? "<r@x.test>" : overrides.messageId,
  });
  await insertTriageResult(
    trx,
    { orgId: tenant.orgId },
    {
      emailId,
      category: overrides?.category ?? "info",
      vip: false,
      confidence: 0.9,
      reasonCode: "llm",
      reason: null,
      fields: overrides?.fields ?? {},
      model: "gemini-3.5-flash-lite",
      promptVersion: "classifier-v1",
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
    }
  );
  return emailId;
}

async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("triage_feedback").selectAll().where("email_id", "=", emailId).execute();
}

describe("recordFeedback", () => {
  test("a true category gives right when it equals the latest category, else wrong", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const emailRight = await createTriagedEmail(trx, a);
      const emailWrong = await createTriagedEmail(trx, a);

      const right = await recordFeedback(trx, ctx, {
        emailId: emailRight,
        trueCategory: "info",
        source: "cli",
        userId: a.userId,
      });
      const wrong = await recordFeedback(trx, ctx, { emailId: emailWrong, trueCategory: "spam", source: "cli" });

      expect(right.verdict).toBe("right");
      expect(wrong.verdict).toBe("wrong");
      expect(await feedbackRows(trx, emailRight)).toMatchObject([
        { id: right.id, verdict: "right", true_category: "info", source: "cli", user_id: a.userId },
      ]);
      expect(await feedbackRows(trx, emailWrong)).toMatchObject([
        { id: wrong.id, verdict: "wrong", true_category: "spam", user_id: null },
      ]);
    });
  });

  test("skipIfSame writes nothing for a repeated answer; without it every label is a row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const plain = await createTriagedEmail(trx, a, { messageId: "<p@x.test>" });
      const skipped = await createTriagedEmail(trx, a, { messageId: "<s@x.test>" });

      const one = await recordFeedback(trx, ctx, { emailId: plain, trueCategory: "info", source: "cli" });
      const two = await recordFeedback(trx, ctx, { emailId: plain, trueCategory: "info", source: "cli" });
      expect([one.saved, two.saved]).toEqual([true, true]);
      expect(await feedbackRows(trx, plain)).toHaveLength(2);

      const first = await recordFeedback(trx, ctx, {
        emailId: skipped,
        trueCategory: "info",
        source: "telegram",
        skipIfSame: true,
      });
      const repeat = await recordFeedback(trx, ctx, {
        emailId: skipped,
        trueCategory: "info",
        source: "telegram",
        skipIfSame: true,
      });
      expect(first.saved).toBe(true);
      expect(repeat).toEqual({ id: first.id, verdict: "right", saved: false });
      expect(await feedbackRows(trx, skipped)).toHaveLength(1);
    });
  });

  test("a verdict alone is stored with a NULL true category", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const emailId = await createTriagedEmail(trx, a);

      const result = await recordFeedback(trx, { orgId: a.orgId }, { emailId, verdict: "wrong", source: "telegram" });

      expect(result.verdict).toBe("wrong");
      expect(await feedbackRows(trx, emailId)).toMatchObject([
        { verdict: "wrong", true_category: null, source: "telegram" },
      ]);
    });
  });

  test("a verdict alone on an unsure result is an error and writes no row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const emailId = await createTriagedEmail(trx, a, { category: "unsure" });

      for (const verdict of ["right", "wrong"] as const) {
        await expect(recordFeedback(trx, ctx, { emailId, verdict, source: "cli" })).rejects.toThrow(
          "unsure is not a label: give a true category"
        );
      }
      expect(await feedbackRows(trx, emailId)).toEqual([]);
    });
  });

  test("a true category on an unsure result is stored as wrong", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const emailId = await createTriagedEmail(trx, a, { category: "unsure" });

      const result = await recordFeedback(trx, { orgId: a.orgId }, { emailId, trueCategory: "info", source: "cli" });

      expect(result.verdict).toBe("wrong");
      expect(await feedbackRows(trx, emailId)).toMatchObject([{ verdict: "wrong", true_category: "info" }]);
    });
  });

  test("neither a category nor a verdict is an error", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const emailId = await createTriagedEmail(trx, a);

      await expect(recordFeedback(trx, { orgId: a.orgId }, { emailId, source: "cli" })).rejects.toBeInstanceOf(
        HardError
      );
      expect(await feedbackRows(trx, emailId)).toEqual([]);
    });
  });

  test("an email of another org is an error", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const emailA = await createTriagedEmail(trx, a);

      await expect(
        recordFeedback(trx, { orgId: b.orgId }, { emailId: emailA, verdict: "right", source: "cli" })
      ).rejects.toThrow("email has no triage result");
      expect(await feedbackRows(trx, emailA)).toEqual([]);
    });
  });

  test("an email without a triage result is an error", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId: a.orgId }, a.mailboxId);

      await expect(
        recordFeedback(trx, { orgId: a.orgId }, { emailId, verdict: "right", source: "cli" })
      ).rejects.toThrow("email has no triage result");
    });
  });
});

describe("listForLabeling", () => {
  test("returns the summary, the model category, and leaves out synthetic mail for real", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const withSummary = await createTriagedEmail(trx, a, { fields: { model_category: "spam" } });
      const noSummary = await createTriagedEmail(trx, a);
      const synthetic = await createTriagedEmail(trx, a, { messageId: "<s@ea-seed.test>" });
      await createPlanned(trx, ctx, withSummary, [
        { type: "save_summary", payload: { summary: "short summary" }, status: "logged", idempotencyKey: "fb-summary" },
      ]);

      const real = await listForLabeling(trx, ctx, a.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS });
      expect(real.map((item) => item.emailId).sort()).toEqual([withSummary, noSummary].sort());
      expect(real.find((item) => item.emailId === withSummary)).toMatchObject({
        category: "info",
        confidence: 0.9,
        modelCategory: "spam",
        summary: "short summary",
      });
      expect(real.find((item) => item.emailId === noSummary)).toMatchObject({ modelCategory: null, summary: null });

      const fake = await listForLabeling(trx, ctx, a.mailboxId, {
        limit: 10,
        mail: "synthetic",
        testMail: NO_TEST_SENDERS,
      });
      expect(fake.map((item) => item.emailId)).toEqual([synthetic]);

      await recordFeedback(trx, ctx, { emailId: noSummary, verdict: "right", source: "cli" });
      const after = await listForLabeling(trx, ctx, a.mailboxId, {
        limit: 10,
        mail: "real",
        testMail: NO_TEST_SENDERS,
      });
      expect(after.map((item) => item.emailId)).toEqual([withSummary]);
    });
  });
});
