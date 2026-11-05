import { randomUUID } from "node:crypto";

import type { SenderRule } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, countLlmCallsSince, recordAudit } from "../../src/modules/audit";
import { insertSenderRule, listSenderRules } from "../../src/modules/config";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, testCapabilities } from "./fixtures";
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

async function addMailbox(trx: Transaction<DB>, ctx: TenantContext): Promise<string> {
  const id = randomUUID();
  await insertMailbox(trx, ctx, {
    id,
    address: `second-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  return id;
}

async function senderRuleRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("sender_rules")
    .select(["org_id", "mailbox_id", "pattern", "kind"])
    .where("org_id", "=", orgId)
    .execute();
}

async function auditRows(trx: Transaction<DB>, orgId: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).orderBy("id").execute();
}

function byPattern(rules: SenderRule[]): SenderRule[] {
  return [...rules].sort((x, y) => x.pattern.localeCompare(y.pattern));
}

function llmCallData(mailboxId: string) {
  return {
    mailbox_id: mailboxId,
    model: "gemini-3.5-flash-lite",
    prompt_version: "classifier-v1",
    tokens_in: 100,
    tokens_out: 20,
    latency_ms: 800,
  };
}

describe("config repository: sender rules", () => {
  test("insertSenderRule stores the context org, trims and lower-cases, returns false on a duplicate", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);

      expect(await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "  Boss@Firma.TEST ", kind: "vip" })).toBe(
        true
      );
      expect(await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "boss@firma.test", kind: "vip" })).toBe(
        false
      );
      expect(
        await insertSenderRule(trx, a.ctx, { mailboxId: a.mailboxId, pattern: "firma.test", kind: "whitelist" })
      ).toBe(true);
      expect(
        await insertSenderRule(trx, a.ctx, { mailboxId: a.mailboxId, pattern: "FIRMA.test", kind: "whitelist" })
      ).toBe(false);
      // The same pattern with another kind or in another org is not a duplicate.
      expect(
        await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "boss@firma.test", kind: "whitelist" })
      ).toBe(true);
      expect(await insertSenderRule(trx, b.ctx, { mailboxId: null, pattern: "boss@firma.test", kind: "vip" })).toBe(
        true
      );

      const rowsA = await senderRuleRows(trx, a.ctx.orgId);
      expect(rowsA).toHaveLength(3);
      expect(rowsA.find((row) => row.kind === "vip")).toEqual({
        org_id: a.ctx.orgId,
        mailbox_id: null,
        pattern: "boss@firma.test",
        kind: "vip",
      });
      expect(rowsA.find((row) => row.mailbox_id === a.mailboxId)?.pattern).toBe("firma.test");
      expect(await senderRuleRows(trx, b.ctx.orgId)).toHaveLength(1);
    });
  });

  test("listSenderRules returns org-wide and same-mailbox rules of the context org only", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const otherMailboxId = await addMailbox(trx, a.ctx);

      await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "org-wide.test", kind: "blocklist" });
      await insertSenderRule(trx, a.ctx, { mailboxId: a.mailboxId, pattern: "boss@firma.test", kind: "vip" });
      await insertSenderRule(trx, a.ctx, { mailboxId: otherMailboxId, pattern: "other-box.test", kind: "whitelist" });
      await insertSenderRule(trx, b.ctx, { mailboxId: null, pattern: "other-org.test", kind: "blocklist" });
      await insertSenderRule(trx, b.ctx, { mailboxId: b.mailboxId, pattern: "other-org-box.test", kind: "vip" });

      expect(byPattern(await listSenderRules(trx, a.ctx, a.mailboxId))).toEqual([
        { pattern: "boss@firma.test", kind: "vip" },
        { pattern: "org-wide.test", kind: "blocklist" },
      ]);

      expect(await listSenderRules(trx, a.ctx, otherMailboxId)).toHaveLength(2);
      // The mailbox of org B with the context of org A: only the org-wide rules of org A.
      expect(await listSenderRules(trx, a.ctx, b.mailboxId)).toEqual([{ pattern: "org-wide.test", kind: "blocklist" }]);
      expect(byPattern(await listSenderRules(trx, b.ctx, b.mailboxId))).toEqual([
        { pattern: "other-org-box.test", kind: "vip" },
        { pattern: "other-org.test", kind: "blocklist" },
      ]);
    });
  });
});

describe("audit repository", () => {
  test("recordAudit stores the context org; with `at` it stores that time, without it now()", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const at = new Date("2026-11-04T08:30:00Z");

      await recordAudit(trx, a.ctx, {
        emailId,
        actor: "system",
        event: auditEvents.emailTriaged,
        reasonCode: "llm",
        data: { category: "info", confidence: 0.9, vip: false, rule: null },
        at,
      });
      await recordAudit(trx, a.ctx, { actor: "system", event: auditEvents.llmCall, reasonCode: "ok" });

      const rows = await auditRows(trx, a.ctx.orgId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailId,
        action_id: null,
        actor: "system",
        event: "email.triaged",
        reason_code: "llm",
        data: { category: "info", confidence: 0.9, vip: false, rule: null },
      });
      expect(rows[0]?.created_at.toISOString()).toBe(at.toISOString());

      expect(rows[1]).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: null,
        action_id: null,
        event: "llm.call",
        reason_code: "ok",
        data: {},
      });
      // The DB clock and the test clock can differ a little: allow 1 min both ways.
      const age = Math.abs(Date.now() - (rows[1]?.created_at.getTime() ?? 0));
      expect(age).toBeLessThan(60_000);

      expect(await auditRows(trx, b.ctx.orgId)).toHaveLength(0);
    });
  });

  test("countLlmCallsSince counts only llm.call rows of this org and mailbox at or after `since`", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const otherMailboxId = await addMailbox(trx, a.ctx);
      const since = new Date("2026-11-04T08:00:00Z");
      const inside = new Date("2026-11-04T09:00:00Z");

      // Counted: at `since` and after it, success and error outcomes.
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: llmCallData(a.mailboxId),
        at: since,
      });
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "http_429",
        data: { ...llmCallData(a.mailboxId), tokens_in: null, tokens_out: null },
        at: inside,
      });

      // Not counted: before `since`, another event, another mailbox, another org.
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: llmCallData(a.mailboxId),
        at: new Date(since.getTime() - 1),
      });
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.emailTriaged,
        reasonCode: "llm",
        data: { mailbox_id: a.mailboxId },
        at: inside,
      });
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: llmCallData(otherMailboxId),
        at: inside,
      });
      await recordAudit(trx, b.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: llmCallData(a.mailboxId),
        at: inside,
      });
      await recordAudit(trx, b.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: llmCallData(b.mailboxId),
        at: inside,
      });

      expect(await countLlmCallsSince(trx, a.ctx, a.mailboxId, since)).toBe(2);
      expect(await countLlmCallsSince(trx, a.ctx, otherMailboxId, since)).toBe(1);
      expect(await countLlmCallsSince(trx, a.ctx, b.mailboxId, since)).toBe(0);
      expect(await countLlmCallsSince(trx, b.ctx, a.mailboxId, since)).toBe(1);
      expect(await countLlmCallsSince(trx, b.ctx, b.mailboxId, since)).toBe(1);
      expect(await countLlmCallsSince(trx, a.ctx, a.mailboxId, new Date("2026-11-04T10:00:00Z"))).toBe(0);
    });
  });
});
