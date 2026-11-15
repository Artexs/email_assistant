import { costPerMail, type LiveRunPlan } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { recordLlmCall } from "../../src/modules/audit";
import { runSpend, type LabRun } from "../../src/modules/lab";
import { countOrgEmails } from "../../src/modules/mail";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const plan: LiveRunPlan = {
  runId: "day-20261123-0001",
  mode: "day",
  startDate: "2026-11-23",
  offsetDays: 0,
  scenarioDays: [1],
  items: [],
  endsAt: "2026-11-23T23:00:00.000Z",
  tailEndsAt: "2026-11-24T23:00:00.000Z",
  deadlines: [],
};
const run: LabRun = { plan, org: "lab", capUsd: 1 };
const AT = new Date("2026-11-23T10:00:00Z");

describe("lab run spend (stage 05 test 7)", () => {
  test("two priced calls cost 2 x costPerMail; a call of another org is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const call = (org: typeof a, model: string, at: Date = AT) =>
        recordLlmCall(
          trx,
          { orgId: org.orgId },
          {
            mailboxId: org.mailboxId,
            role: "classifier",
            promptVersion: "test",
            model,
            outcome: "ok",
            tokensIn: 1000,
            tokensOut: 200,
            latencyMs: 10,
            at,
          }
        );
      await call(a, "gpt-6-luna");
      await call(a, "gpt-6-luna");
      await call(b, "gpt-6-luna");
      // Before the plan start: not part of the run.
      await call(a, "gpt-6-luna", new Date("2026-11-22T10:00:00Z"));

      const one = costPerMail("gpt-6-luna", 1000, 200, AT) as number;
      const spend = await runSpend(trx, a.orgId, run);
      expect(spend.kind).toBe("ok");
      expect(spend.calls).toBe(2);
      expect(spend.usd).toBeCloseTo(2 * one, 12);
      expect(spend.usd).toBeGreaterThan(0);
    });
  });

  test("a call of a model with no price makes the spend unpriced (never $0)", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const call = (model: string) =>
        recordLlmCall(
          trx,
          { orgId: a.orgId },
          {
            mailboxId: a.mailboxId,
            role: "classifier",
            promptVersion: "test",
            model,
            outcome: "ok",
            tokensIn: 1000,
            tokensOut: 200,
            latencyMs: 10,
            at: AT,
          }
        );
      await call("gpt-6-luna");
      await call("x-unknown");
      const spend = await runSpend(trx, a.orgId, run);
      expect(spend.kind).toBe("unpriced");
      expect(spend.unpricedCalls).toBe(1);
      expect(spend.calls).toBe(2);
      expect(spend.usd).toBeCloseTo(costPerMail("gpt-6-luna", 1000, 200, AT) as number, 12);
    });
  });

  test("an org with no call costs $0 and is ok", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      expect(await runSpend(trx, a.orgId, run)).toEqual({ kind: "ok", usd: 0, calls: 0, unpricedCalls: 0 });
    });
  });
});

describe("countOrgEmails (stage 05 test 6, org_not_fresh)", () => {
  test("counts every mail row of the org and no row of another org", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      expect(await countOrgEmails(trx, { orgId: a.orgId })).toBe(0);
      await insertTestEmail(trx, { orgId: a.orgId }, a.mailboxId);
      await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId, { status: "triaged" });
      expect(await countOrgEmails(trx, { orgId: a.orgId })).toBe(1);
      expect(await countOrgEmails(trx, { orgId: b.orgId })).toBe(1);
    });
  });
});
