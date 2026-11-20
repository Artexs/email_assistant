import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { claimEmails, type ClaimedEmail } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { finishTriageError, saveTriage, triageOne } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import {
  now,
  setup,
  decision,
  results,
  audit,
  emailStatus,
  fakeLlm,
  analysis,
  fakePause,
  setupMail,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("saveTriage", () => {
  test("saves an info decision: result, actions and audit rows", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      expect(await saveTriage(trx, ctx, mailbox, email, decision(), now)).toEqual({ kind: "triaged" });
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
      expect(rows[0]?.suspicious_reasons).toEqual([]);
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info", rule: null });

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
        suspicious: "",
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
      expect(await saveTriage(trx, ctx, mailbox, email, below, now)).toEqual({ kind: "triaged" });

      const rows = await results(trx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: "unsure", reason_code: "fyi", confidence: 0.5 });
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info", rule: null });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status, a.payload])).toEqual([["move", "logged", { folder: "ai_manual" }]]);
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("below_threshold");
    });
  });

  test("stores NULL tokens without usage and no model_category without a model category", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision({ usage: null, modelCategory: null, model: null }), now);
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ tokens_in: null, tokens_out: null, latency_ms: null, model: null });
      expect(row?.fields).toEqual({ lang: "pl", rule: null });
    });
  });

  test("a lost claim returns lost, writes nothing and does not break the transaction", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + MINUTE_MS) })
        .where("id", "=", emailId)
        .execute();
      expect(await saveTriage(trx, ctx, mailbox, email, decision(), now)).toEqual({ kind: "lost" });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(0);
      expect(await audit(trx, emailId)).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("processing");
    });
  });

  test("a second save creates a second result but no second set of actions", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision(), now);
      await trx.updateTable("emails").set({ status: "pending" }).where("id", "=", emailId).execute();
      const [again]: ClaimedEmail[] = await claimEmails(trx, ctx, mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
        syntheticOnly: false,
      });
      if (!again) throw new Error("second claim failed");
      expect(await saveTriage(trx, ctx, mailbox, again, decision(), now)).toEqual({ kind: "triaged" });

      expect(await results(trx, emailId)).toHaveLength(2);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(2);
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(2);
    });
  });
});

describe("the rule that shaped a result (F110 stage 16)", () => {
  const deps = (trx: Transaction<DB>, llm: ReturnType<typeof fakeLlm>) => ({
    db: trx,
    llm,
    pause: fakePause(),
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => now,
  });

  async function ruleOf(from: string, rules: { pattern: string; kind: "blocklist" | "whitelist" | "vip" }[]) {
    let fields: Record<string, unknown> = {};
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: from }, rules);
      await triageOne(deps(trx, fakeLlm(analysis())), ctx, mailbox, email);
      const [row] = await results(trx, emailId);
      fields = row?.fields as Record<string, unknown>;
    });
    return fields;
  }

  test("a blocklisted sender: rule blocklist, and the pattern is not stored", async () => {
    const fields = await ruleOf("bad@spam.test", [{ pattern: "spam.test", kind: "blocklist" }]);
    expect(fields.rule).toBe("blocklist");
    expect(JSON.stringify(fields)).not.toContain("spam.test");
  });

  test("a VIP: rule vip, also when the sender is on the whitelist and the blocklist too", async () => {
    const vip = [{ pattern: "boss@firma.test", kind: "vip" as const }];
    expect((await ruleOf("boss@firma.test", vip)).rule).toBe("vip");
    const all = [
      ...vip,
      { pattern: "firma.test", kind: "whitelist" as const },
      { pattern: "firma.test", kind: "blocklist" as const },
    ];
    expect((await ruleOf("boss@firma.test", all)).rule).toBe("vip");
  });

  test("a whitelisted sender that is not VIP: rule whitelist, also against a blocklist hit", async () => {
    expect((await ruleOf("a@corp.test", [{ pattern: "corp.test", kind: "whitelist" }])).rule).toBe("whitelist");
    const both = [
      { pattern: "corp.test", kind: "blocklist" as const },
      { pattern: "a@corp.test", kind: "whitelist" as const },
    ];
    expect((await ruleOf("a@corp.test", both)).rule).toBe("whitelist");
  });

  test("no rule hit: rule null, the key is there, and the model fields stay", async () => {
    const fields = await ruleOf("x@else.test", [{ pattern: "corp.test", kind: "whitelist" }]);
    expect("rule" in fields).toBe(true);
    expect(fields.rule).toBeNull();
    expect(fields.model_category).toBe("info");
  });

  test("an error result of a VIP keeps the rule", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "boss@firma.test" }, [
        { pattern: "boss@firma.test", kind: "vip" },
      ]);
      expect(await finishTriageError(deps(trx, fakeLlm(analysis())), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "triage_error" });
      expect((row?.fields as Record<string, unknown>).rule).toBe("vip");
    });
  });
});
