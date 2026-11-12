import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  createOrganizationWithOwner,
  getOrgPlan,
  isOrgSuspended,
  listOrganizations,
  setOrgPlan,
} from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-12T10:00:00Z");
const dayMs = 24 * 60 * 60 * 1000;
const input = { actor: "operator", now };

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectConstraint(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, constraint: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code: "23514", constraint });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

async function newOrg(trx: Transaction<DB>, plan?: Parameters<typeof createOrganizationWithOwner>[1]["plan"]) {
  const suffix = randomUUID();
  const { orgId } = await createOrganizationWithOwner(trx, {
    orgName: `Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `owner-${suffix}@x.test`,
    displayName: "Owner",
    ...(plan ? { plan } : {}),
  });
  return { orgId };
}

async function planAudit(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "org.plan_changed")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

describe("organizations plan columns", () => {
  test("the checks have names and a plain insert is active with two mailboxes", async () => {
    await withRollback(db, async (trx) => {
      await expectConstraint(
        trx,
        "trial_without_end",
        () => trx.insertInto("organizations").values({ name: "x", timezone: "UTC", plan: "trial" }).execute(),
        "organizations_trial_end_check"
      );
      await expectConstraint(
        trx,
        "plan_gold",
        () => trx.insertInto("organizations").values({ name: "x", timezone: "UTC", plan: "gold" }).execute(),
        "organizations_plan_check"
      );
      await expectConstraint(
        trx,
        "max_negative",
        () => trx.insertInto("organizations").values({ name: "x", timezone: "UTC", max_mailboxes: -1 }).execute(),
        "organizations_max_mailboxes_check"
      );
      const row = await trx
        .insertInto("organizations")
        .values({ name: "x", timezone: "UTC" })
        .returningAll()
        .executeTakeFirstOrThrow();
      expect(row.plan).toBe("active");
      expect(row.max_mailboxes).toBe(2);
      expect(row.trial_ends_at).toBeNull();
      expect(row.resumed_at).toBeNull();
    });
  });
});

describe("createOrganizationWithOwner plan", () => {
  test("a trial input stores the plan and the date; no plan means active", async () => {
    await withRollback(db, async (trx) => {
      const endsAt = new Date(now.getTime() + 30 * dayMs);
      const trial = await newOrg(trx, { kind: "trial", endsAt });
      expect(await getOrgPlan(trx, trial)).toEqual({
        plan: "trial",
        trialEndsAt: endsAt,
        maxMailboxes: 2,
        resumedAt: null,
      });
      const plain = await newOrg(trx);
      expect((await getOrgPlan(trx, plain))?.plan).toBe("active");
      const explicit = await newOrg(trx, { kind: "active" });
      expect((await getOrgPlan(trx, explicit))?.plan).toBe("active");
    });
  });
});

describe("setOrgPlan", () => {
  test("active to suspended audits, calls the hook once and keeps resumed_at", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      const calls: unknown[][] = [];
      const result = await setOrgPlan(
        trx,
        ctx,
        { ...input, plan: "suspended" },
        {
          onSuspended: async (...args) => {
            calls.push(args);
            return 3;
          },
        }
      );
      expect(result).toMatchObject({
        kind: "changed",
        cancelledMessages: 3,
        before: { plan: "active" },
        after: { plan: "suspended", trialEndsAt: null, resumedAt: null },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe(trx);
      expect(calls[0]?.[1]).toBe(ctx);
      expect((await getOrgPlan(trx, ctx))?.resumedAt).toBeNull();
      const audit = await planAudit(trx, ctx.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe("operator");
      expect(audit[0]?.data).toEqual({
        from: "active",
        to: "suspended",
        max_from: 2,
        max_to: 2,
        trial_ends_at: null,
      });
    });
  });

  test("suspended to active sets resumed_at and calls no hook", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      await setOrgPlan(trx, ctx, { ...input, plan: "suspended" });
      let called = 0;
      const result = await setOrgPlan(
        trx,
        ctx,
        { ...input, plan: "active" },
        {
          onSuspended: async () => {
            called += 1;
            return 1;
          },
        }
      );
      expect(result).toMatchObject({ kind: "changed", cancelledMessages: 0 });
      expect(called).toBe(0);
      expect((await getOrgPlan(trx, ctx))?.resumedAt).toEqual(now);
    });
  });

  test("suspended to active calls the resume hook once with now and the actor; other changes do not", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      const calls: { now: Date; actor: string }[] = [];
      const hooks = {
        onResumed: async (_trx: Transaction<DB>, _ctx: unknown, args: { now: Date; actor: string }) => {
          calls.push(args);
          return 2;
        },
      };
      await setOrgPlan(trx, ctx, { ...input, plan: "trial", trialDays: 5 }, hooks);
      await setOrgPlan(trx, ctx, { ...input, plan: "suspended" }, hooks);
      expect(calls).toEqual([]);
      const result = await setOrgPlan(trx, ctx, { ...input, plan: "active" }, hooks);
      expect(result).toMatchObject({ kind: "changed", expiredSends: 2 });
      expect(calls).toEqual([{ now, actor: "operator" }]);
    });
  });

  test("suspended to trial with trialDays sets the end and resumed_at", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      await setOrgPlan(trx, ctx, { ...input, plan: "suspended" });
      const result = await setOrgPlan(trx, ctx, { ...input, plan: "trial", trialDays: 14 });
      expect(result.kind).toBe("changed");
      expect(await getOrgPlan(trx, ctx)).toMatchObject({
        plan: "trial",
        trialEndsAt: new Date(now.getTime() + 14 * dayMs),
        resumedAt: now,
      });
    });
  });

  test("active to trial without trialDays writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      expect(await setOrgPlan(trx, ctx, { ...input, plan: "trial" })).toEqual({ kind: "trial_days_needed" });
      expect((await getOrgPlan(trx, ctx))?.plan).toBe("active");
      expect(await planAudit(trx, ctx.orgId)).toHaveLength(0);
    });
  });

  test("trial keeps its date when only the mailbox limit changes; trial to active clears the date", async () => {
    await withRollback(db, async (trx) => {
      const endsAt = new Date(now.getTime() + 30 * dayMs);
      const ctx = await newOrg(trx, { kind: "trial", endsAt });
      const kept = await setOrgPlan(trx, ctx, { ...input, plan: "trial", maxMailboxes: 5 });
      expect(kept.kind).toBe("changed");
      expect(await getOrgPlan(trx, ctx)).toMatchObject({ plan: "trial", trialEndsAt: endsAt, maxMailboxes: 5 });
      const active = await setOrgPlan(trx, ctx, { ...input, plan: "active" });
      expect(active.kind).toBe("changed");
      expect(await getOrgPlan(trx, ctx)).toMatchObject({ plan: "active", trialEndsAt: null, maxMailboxes: 5 });
    });
  });

  test("unchanged and bad input write nothing", async () => {
    await withRollback(db, async (trx) => {
      const ctx = await newOrg(trx);
      const same = await setOrgPlan(trx, ctx, { ...input, plan: "active", maxMailboxes: 2 });
      expect(same).toMatchObject({ kind: "unchanged", state: { plan: "active", maxMailboxes: 2 } });
      expect(await setOrgPlan(trx, ctx, input)).toEqual({ kind: "bad_input", reason: "nothing_to_change" });
      expect(await setOrgPlan(trx, ctx, { ...input, plan: "trial", trialDays: 0 })).toEqual({
        kind: "bad_input",
        reason: "trial_days_range",
      });
      expect(await setOrgPlan(trx, ctx, { ...input, maxMailboxes: 101 })).toEqual({
        kind: "bad_input",
        reason: "max_mailboxes_range",
      });
      expect(await setOrgPlan(trx, ctx, { ...input, plan: "active", trialDays: 5 })).toEqual({
        kind: "bad_input",
        reason: "trial_days_without_trial",
      });
      expect(await planAudit(trx, ctx.orgId)).toHaveLength(0);
    });
  });

  test("a limit below the mailbox count is allowed", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const result = await setOrgPlan(trx, { orgId }, { ...input, maxMailboxes: 0 });
      expect(result).toMatchObject({ kind: "changed", after: { maxMailboxes: 0 } });
    });
  });

  test("a throw in the hook rolls the whole change back", async () => {
    // Committed organization: inside withRollback the service joins the outer transaction and cannot roll back alone.
    const suffix = randomUUID();
    const { orgId } = await createOrganizationWithOwner(db, {
      orgName: `Org ${suffix}`,
      timezone: "Europe/Warsaw",
      email: `owner-${suffix}@x.test`,
      displayName: "Owner",
    });
    try {
      await expect(
        setOrgPlan(
          db,
          { orgId },
          { ...input, plan: "suspended" },
          {
            onSuspended: async () => {
              throw new Error("hook failed");
            },
          }
        )
      ).rejects.toThrow("hook failed");
      expect((await getOrgPlan(db, { orgId }))?.plan).toBe("active");
      const audit = await db
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", orgId)
        .where("event", "=", "org.plan_changed")
        .execute();
      expect(audit).toHaveLength(0);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", orgId).execute();
    }
  });

  test("an unknown organization is not_found", async () => {
    expect(await setOrgPlan(db, { orgId: randomUUID() }, { ...input, plan: "suspended" })).toEqual({
      kind: "not_found",
    });
  });
});

describe("plan reads", () => {
  test("getOrgPlan and isOrgSuspended read only their own organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await setOrgPlan(trx, a, { ...input, plan: "suspended", maxMailboxes: 7 });
      expect(await isOrgSuspended(trx, a)).toBe(true);
      expect(await isOrgSuspended(trx, b)).toBe(false);
      expect(await isOrgSuspended(trx, { orgId: randomUUID() })).toBe(false);
      expect(await getOrgPlan(trx, b)).toMatchObject({ plan: "active", maxMailboxes: 2 });
      expect(await getOrgPlan(trx, { orgId: randomUUID() })).toBeUndefined();
    });
  });

  test("listOrganizations holds both organizations with the mapped fields", async () => {
    await withRollback(db, async (trx) => {
      const endsAt = new Date(now.getTime() + 30 * dayMs);
      const a = await newOrg(trx);
      const b = await newOrg(trx, { kind: "trial", endsAt });
      const list = await listOrganizations(trx);
      expect(list.find((org) => org.id === a.orgId)).toEqual({
        id: a.orgId,
        plan: "active",
        trialEndsAt: null,
        timezone: "Europe/Warsaw",
        dataRetentionDays: expect.any(Number),
        resumedAt: null,
      });
      expect(list.find((org) => org.id === b.orgId)).toMatchObject({ id: b.orgId, plan: "trial", trialEndsAt: endsAt });
    });
  });
});
