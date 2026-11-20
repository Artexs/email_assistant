import { afterAll, describe, expect, test } from "bun:test";

import { recordLlmCall } from "../../src/modules/audit";
import { checkLlmErrors } from "../../src/modules/operator";

import { suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import { type Trx, cfg, at, NOW, makeInRollback, orgWithMailbox } from "./slo-checks-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const inRollback = makeInRollback(db);

async function llmCalls(trx: Trx, org: { orgId: string; mailboxId: string }, outcomes: string[], time: Date) {
  for (const outcome of outcomes) {
    await recordLlmCall(
      trx,
      { orgId: org.orgId },
      {
        mailboxId: org.mailboxId,
        role: "classifier",
        promptVersion: "v1",
        model: "test-model",
        endpoint: "standard",
        provider: "openai" as const,
        outcome,
        tokensIn: null,
        tokensOut: null,
        latencyMs: 10,
        at: time,
      }
    );
  }
}

const okCalls = (count: number): string[] => Array.from({ length: count }, () => "ok");
const failCalls = (count: number): string[] => Array.from({ length: count }, () => "http_500");

describe("LLM errors", () => {
  test("10. 2 failed of 10 calls: firing; 3 of 4: clear (too few calls); 3 of 20: between", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(8), ...failCalls(2)], at("09:50"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check).toEqual({
        kind: "slo_llm_errors",
        state: "firing",
        facts: { calls: 10, failed: 2, pct: 20, quota_orgs: 0 },
      });
      expect(reading.ids).toEqual([]);
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(1), ...failCalls(3)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("clear");
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(17), ...failCalls(3)], at("09:50"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("between");
      expect(reading.check.facts.pct).toBe(15);
    });
  });

  test("10b. 10 percent (the clear percent) is between; 5 percent is clear", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(18), ...failCalls(2)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("between");
    });
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      await llmCalls(trx, org, [...okCalls(19), ...failCalls(1)], at("09:50"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.state).toBe("clear");
    });
  });

  test("10c. calls before the window and calls of a suspended organization are not counted", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, org, failCalls(10), at("09:29"));
      await llmCalls(trx, other, failCalls(10), at("09:50"));
      await suspendOrg(trx, other.orgId);
      // An audit row of another event is no call.
      await trx
        .insertInto("audit_log")
        .values({
          org_id: org.orgId,
          actor: "system",
          event: "email.triaged",
          reason_code: "x",
          created_at: at("09:50"),
        })
        .execute();
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("clear");
      expect(reading.check.facts.calls).toBe(0);
      await llmCalls(trx, org, okCalls(5), at("09:30"));
      expect((await checkLlmErrors(trx, NOW, cfg)).check.facts.calls).toBe(5);
    });
  });

  test("11. the newest call of one organization is a spent quota: firing, one quota organization", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, other, ["http_429_quota"], at("07:00"));
      await llmCalls(trx, org, ["http_429_quota"], at("09:30"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts.quota_orgs).toBe(1);
      expect(reading.ids).toEqual([org.orgId]);
    });
  });

  test("11b. a quota call of a suspended organization, or one followed by an ok call, is no quota pause", async () => {
    await inRollback(async (trx) => {
      const org = await orgWithMailbox(trx);
      const other = await orgWithMailbox(trx);
      await llmCalls(trx, other, ["http_429_quota"], at("09:30"));
      await suspendOrg(trx, other.orgId);
      await llmCalls(trx, org, ["http_429_quota"], at("09:30"));
      await llmCalls(trx, org, ["ok"], at("09:40"));
      const reading = await checkLlmErrors(trx, NOW, cfg);
      expect(reading.check.facts.quota_orgs).toBe(0);
      expect(reading.check.state).toBe("clear");
    });
  });
});
