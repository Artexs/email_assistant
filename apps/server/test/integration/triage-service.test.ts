import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { claimEmails, type ClaimedEmail } from "../../src/modules/mail";
import { saveTriage, type TriageDecision, type TriageMailbox } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-05T12:00:00.123Z");

async function setup(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  const emailId = await insertTestEmail(trx, ctx, created.mailboxId);
  const [email] = await claimEmails(trx, ctx, created.mailboxId, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * 60_000),
    syntheticOnly: false,
  });
  if (!email) throw new Error("claim failed");
  const mailbox: TriageMailbox = {
    id: created.mailboxId,
    mode: "shadow",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
    policy: { info: { auto: true } },
    rules: [],
    movesSupported: true,
  };
  return { ctx, emailId, email, mailbox };
}

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    finalCategory: "info",
    modelCategory: "info",
    confidence: 0.9,
    reasonCode: "newsletter",
    reason: "a newsletter",
    summary: "short summary",
    fields: { lang: "pl" },
    vip: false,
    model: "m",
    promptVersion: "classifier-v1",
    usage: { model: "m", tokensIn: 120, tokensOut: 30, latencyMs: 850 },
    auditReasonCode: "newsletter",
    ...overrides,
  };
}

async function results(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("triage_results")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function audit(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function emailStatus(trx: Transaction<DB>, emailId: string): Promise<string> {
  const row = await trx.selectFrom("emails").select("status").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.status;
}

describe("saveTriage", () => {
  test("saves an info decision: result, actions and audit rows", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      expect(await saveTriage(trx, ctx, mailbox, email, decision())).toEqual({ kind: "triaged" });
      expect(await emailStatus(trx, emailId)).toBe("triaged");

      const rows = await results(trx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        category: "info",
        model: "m",
        prompt_version: "classifier-v1",
        tokens_in: 120,
        tokens_out: 30,
        latency_ms: 850,
        reason_code: "newsletter",
      });
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["move", "logged"],
        ["save_summary", "ready"],
      ]);
      const move = actions.find((a) => a.type === "move");
      expect(move?.payload).toEqual({ folder: "ai_info" });

      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(1);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      const triaged = log.find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("newsletter");
      expect(triaged?.data).toEqual({
        mailbox_id: mailbox.id,
        final_category: "info",
        model_category: "info",
        confidence: 0.9,
        prompt_version: "classifier-v1",
        model: "m",
      });
      expect(JSON.stringify(log.map((r) => r.data))).not.toContain("short summary");
    });
  });

  test("a below-threshold decision keeps the model's reason code and logs the move", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      const below = decision({
        finalCategory: "unsure",
        modelCategory: "info",
        confidence: 0.5,
        reasonCode: "fyi",
        summary: null,
        auditReasonCode: "below_threshold",
      });
      expect(await saveTriage(trx, ctx, mailbox, email, below)).toEqual({ kind: "triaged" });

      const rows = await results(trx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: "unsure", reason_code: "fyi", confidence: 0.5 });
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status, a.payload])).toEqual([["move", "logged", { folder: "ai_manual" }]]);
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("below_threshold");
    });
  });

  test("stores NULL tokens without usage and no model_category without a model category", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision({ usage: null, modelCategory: null, model: null }));
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ tokens_in: null, tokens_out: null, latency_ms: null, model: null });
      expect(row?.fields).toEqual({ lang: "pl" });
    });
  });

  test("a lost claim returns lost, writes nothing and does not break the transaction", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", emailId)
        .execute();
      expect(await saveTriage(trx, ctx, mailbox, email, decision())).toEqual({ kind: "lost" });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(0);
      expect(await audit(trx, emailId)).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("processing");
    });
  });

  test("a second save creates a second result but no second set of actions", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision());
      await trx.updateTable("emails").set({ status: "pending" }).where("id", "=", emailId).execute();
      const [again]: ClaimedEmail[] = await claimEmails(trx, ctx, mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      if (!again) throw new Error("second claim failed");
      expect(await saveTriage(trx, ctx, mailbox, again, decision())).toEqual({ kind: "triaged" });

      expect(await results(trx, emailId)).toHaveLength(2);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(2);
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(2);
    });
  });
});
