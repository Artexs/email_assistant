import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { addSenderRule, insertSenderRule, listSenderRuleRows, removeSenderRule } from "../../src/modules/config";
import { deleteSenderRule, mailboxInOrg } from "../../src/modules/config/repo";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");

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

async function auditRows(trx: Transaction<DB>, orgId: string, event: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
}

async function ruleCount(trx: Transaction<DB>, orgId: string): Promise<number> {
  const rows = await trx.selectFrom("sender_rules").select("id").where("org_id", "=", orgId).execute();
  return rows.length;
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectFailure(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

describe("addSenderRule", () => {
  test("adds a normalized rule with an audit row that holds no pattern", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const result = await addSenderRule(trx, a.ctx, {
        mailboxId: null,
        pattern: " Boss@Firma.TEST ",
        kind: "vip",
        actor: "user-1",
        now: NOW,
      });
      expect(result.kind).toBe("added");
      if (result.kind !== "added") throw new Error("unreachable");
      expect(result.rule.pattern).toBe("boss@firma.test");

      const rows = await auditRows(trx, a.ctx.orgId, "rule.added");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor).toBe("user-1");
      expect(rows[0]?.created_at).toEqual(NOW);
      expect(rows[0]?.data).toEqual({ rule_id: result.rule.id, kind: "vip", scope: "org" });
      expect(JSON.stringify(rows[0]?.data)).not.toContain("firma");
    });
  });

  test("a duplicate answers exists and writes no second audit row", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const input = { mailboxId: null, pattern: "boss@firma.test", kind: "vip" as const, actor: "user-1", now: NOW };
      await addSenderRule(trx, a.ctx, input);
      expect(await addSenderRule(trx, a.ctx, input)).toEqual({ kind: "exists" });
      expect(await auditRows(trx, a.ctx.orgId, "rule.added")).toHaveLength(1);
    });
  });

  test("a mailbox-scope rule records the mailbox id", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const result = await addSenderRule(trx, a.ctx, {
        mailboxId: a.mailboxId,
        pattern: "firma.test",
        kind: "whitelist",
        actor: "user-1",
        now: NOW,
      });
      if (result.kind !== "added") throw new Error("expected added");
      const rows = await auditRows(trx, a.ctx.orgId, "rule.added");
      expect(rows[0]?.data).toEqual({
        rule_id: result.rule.id,
        kind: "whitelist",
        scope: "mailbox",
        mailbox_id: a.mailboxId,
      });
    });
  });

  test("another organization's mailbox answers mailbox_not_found", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const result = await addSenderRule(trx, a.ctx, {
        mailboxId: b.mailboxId,
        pattern: "firma.test",
        kind: "vip",
        actor: "user-1",
        now: NOW,
      });
      expect(result).toEqual({ kind: "mailbox_not_found" });
      expect(await ruleCount(trx, a.ctx.orgId)).toBe(0);
      expect(await ruleCount(trx, b.ctx.orgId)).toBe(0);
      expect(await auditRows(trx, a.ctx.orgId, "rule.added")).toHaveLength(0);
    });
  });

  test("an invalid pattern throws a HardError without the pattern", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const error = await addSenderRule(trx, a.ctx, {
        mailboxId: null,
        pattern: "@x.pl",
        kind: "vip",
        actor: "user-1",
        now: NOW,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HardError);
      expect((error as Error).message).toBe("invalid sender pattern");
    });
  });

  test("the cap answers limit; another organization can still add", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await sql`
        INSERT INTO sender_rules (org_id, mailbox_id, pattern, kind)
        SELECT ${a.ctx.orgId}::uuid, NULL, 'r' || n || '.test', 'vip' FROM generate_series(1, 1000) AS n
      `.execute(trx);
      const input = { mailboxId: null, pattern: "new.test", kind: "vip" as const, actor: "user-1", now: NOW };
      expect(await addSenderRule(trx, a.ctx, input)).toEqual({ kind: "limit" });
      expect((await addSenderRule(trx, b.ctx, input)).kind).toBe("added");
    });
  });
});

describe("removeSenderRule", () => {
  test("removes the rule with an audit row; unknown and foreign ids answer not_found", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const added = await addSenderRule(trx, a.ctx, {
        mailboxId: null,
        pattern: "boss@firma.test",
        kind: "vip",
        actor: "user-1",
        now: NOW,
      });
      if (added.kind !== "added") throw new Error("expected added");
      const id = added.rule.id;

      expect(await removeSenderRule(trx, b.ctx, id, { actor: "user-2", now: NOW })).toEqual({ kind: "not_found" });
      expect(await ruleCount(trx, a.ctx.orgId)).toBe(1);

      expect(await removeSenderRule(trx, a.ctx, id, { actor: "user-1", now: NOW })).toEqual({ kind: "removed" });
      expect(await ruleCount(trx, a.ctx.orgId)).toBe(0);
      const rows = await auditRows(trx, a.ctx.orgId, "rule.removed");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data).toEqual({ rule_id: id, kind: "vip", scope: "org" });
      expect(JSON.stringify(rows[0]?.data)).not.toContain("firma");

      expect(await removeSenderRule(trx, a.ctx, id, { actor: "user-1", now: NOW })).toEqual({ kind: "not_found" });
      expect(await auditRows(trx, a.ctx.orgId, "rule.removed")).toHaveLength(1);
    });
  });
});

describe("tenant filters", () => {
  test("listSenderRuleRows never returns another organization's rows", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "a.test", kind: "vip" });
      expect(await listSenderRuleRows(trx, b.ctx, {})).toEqual([]);
    });
  });

  test("listSenderRuleRows with a foreign mailbox id returns only the org-wide rows", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "wide.test", kind: "vip" });
      await insertSenderRule(trx, a.ctx, { mailboxId: a.mailboxId, pattern: "box.test", kind: "vip" });
      const rows = await listSenderRuleRows(trx, a.ctx, { mailboxId: b.mailboxId });
      expect(rows.map((row) => row.pattern)).toEqual(["wide.test"]);
    });
  });

  test("deleteSenderRule with another organization's context deletes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const rule = await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "a.test", kind: "vip" });
      expect(await deleteSenderRule(trx, b.ctx, rule?.id ?? randomUUID())).toBeUndefined();
      expect(await ruleCount(trx, a.ctx.orgId)).toBe(1);
    });
  });

  test("mailboxInOrg is false for another organization's mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect(await mailboxInOrg(trx, a.ctx, b.mailboxId)).toBe(false);
      expect(await mailboxInOrg(trx, a.ctx, a.mailboxId)).toBe(true);
    });
  });

  test("insertSenderRule with another organization's mailbox fails on the composite foreign key", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await expectFailure(
        trx,
        "fk_foreign_mailbox",
        () => insertSenderRule(trx, b.ctx, { mailboxId: a.mailboxId, pattern: "x.test", kind: "vip" }),
        "23503"
      );
    });
  });
});

describe("listSenderRuleRows", () => {
  test("returns org-wide and mailbox rules in created_at, id order with five fields", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const first = await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "wide.test", kind: "blocklist" });
      const second = await insertSenderRule(trx, a.ctx, { mailboxId: a.mailboxId, pattern: "box.test", kind: "vip" });
      // One transaction gives every row the same now(): set distinct times so the order is fixed.
      await sql`UPDATE sender_rules SET created_at = '2026-11-01T00:00:00Z' WHERE id = ${first?.id}`.execute(trx);
      await sql`UPDATE sender_rules SET created_at = '2026-11-02T00:00:00Z' WHERE id = ${second?.id}`.execute(trx);
      const rows = await listSenderRuleRows(trx, a.ctx, {});
      expect(rows.map((row) => row.id)).toEqual([first?.id ?? "", second?.id ?? ""]);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["created_at", "id", "kind", "mailbox_id", "pattern"]);
      expect(rows[1]).toMatchObject({ mailbox_id: a.mailboxId, pattern: "box.test", kind: "vip" });
      expect(rows[0]?.created_at).toBeInstanceOf(Date);
    });
  });
});
