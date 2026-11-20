import { replyEligibility, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { loadReplyFacts } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The join of the mail facts, the suspicion and the triage result, and what the rule says about it.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-17T12:00:00Z");

async function captured(trx: Transaction<DB>, orgId: string, emailId: string): Promise<void> {
  await trx
    .insertInto("email_headers")
    .values({ email_id: emailId, org_id: orgId, parts_known: true, captured_at: NOW })
    .execute();
}

// The facts of one mail; a missing entry fails the test.
function pick<T>(map: Map<string, T>, id: string): T {
  const found = map.get(id);
  if (found === undefined) throw new Error("no facts for the mail");
  return found;
}

async function setup(trx: Transaction<DB>) {
  const org = await createOrgWithMailbox(trx);
  return { ...org, ctx: { orgId: org.orgId } };
}

describe("loadReplyFacts", () => {
  test("a triaged mail with headers and a clean result is eligible on auto and on tap", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const id = await insertTriaged(trx, ctx, mailboxId, {
        category: "needs_reply",
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        receivedAt: new Date(NOW.getTime() - HOUR_MS),
        from: "anna@client.test",
        fields: { language: "en" },
      });
      await captured(trx, ctx.orgId, id);
      const loaded = pick(await loadReplyFacts(trx, ctx, [id], { ownerLocale: null }), id);
      expect(loaded.facts).toMatchObject({
        triaged: true,
        category: "needs_reply",
        language: "en",
        fromJunk: false,
        fromAddress: "anna@client.test",
        suspicion: { state: "clean" },
        answered: false,
        ownerLocale: null,
      });
      expect(loaded.mail.mailboxId).toBe(mailboxId);
      expect(replyEligibility(loaded.facts, { trigger: "auto", now: NOW })).toEqual({ ok: true, language: "en" });
      expect(replyEligibility(loaded.facts, { trigger: "tap", now: NOW })).toEqual({ ok: true, language: "en" });
    });
  });

  test("an untriaged mail is not checked, also on a tap", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, ctx, mailboxId, { from_address: "anna@client.test" });
      await captured(trx, ctx.orgId, id);
      const loaded = pick(await loadReplyFacts(trx, ctx, [id], { ownerLocale: null }), id);
      expect(loaded.facts).toMatchObject({ triaged: false, category: null, suspicion: { state: "untriaged" } });
      expect(replyEligibility(loaded.facts, { trigger: "tap", now: NOW })).toEqual({
        ok: false,
        reason: "not_checked",
      });
    });
  });

  test("a mail with no email_headers row is not checked, also on a tap", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const id = await insertTriaged(trx, ctx, mailboxId, {
        category: "needs_reply",
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        from: "anna@client.test",
        fields: { language: "pl" },
      });
      const loaded = pick(await loadReplyFacts(trx, ctx, [id], { ownerLocale: null }), id);
      expect(loaded.facts.headers).toBeNull();
      expect(replyEligibility(loaded.facts, { trigger: "tap", now: NOW })).toEqual({
        ok: false,
        reason: "not_checked",
      });
    });
  });

  test("a flagged mail is suspicious for every trigger", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const id = await insertTriaged(trx, ctx, mailboxId, {
        category: "needs_reply",
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        from: "anna@client.test",
        fields: { language: "pl" },
        suspiciousReasons: ["reply_to_mismatch"],
      });
      await captured(trx, ctx.orgId, id);
      const loaded = pick(await loadReplyFacts(trx, ctx, [id], { ownerLocale: null }), id);
      for (const trigger of ["auto", "tap", "redraft", "sample"] as const) {
        expect(replyEligibility(loaded.facts, { trigger, now: NOW })).toEqual({ ok: false, reason: "suspicious" });
      }
    });
  });

  test("a language that is missing or not pl, en or other reads as other; the owner locale is passed on", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const mail = async (fields: Record<string, unknown>) => {
        const id = await insertTriaged(trx, ctx, mailboxId, {
          category: "needs_reply",
          createdAt: new Date(NOW.getTime() - HOUR_MS),
          from: "anna@client.test",
          fields,
        });
        await captured(trx, ctx.orgId, id);
        return id;
      };
      const missing = await mail({});
      const odd = await mail({ language: "de" });
      const loaded = await loadReplyFacts(trx, ctx, [missing, odd], { ownerLocale: "en" });
      for (const id of [missing, odd]) {
        const { facts } = pick(loaded, id);
        expect(facts.language).toBe("other");
        expect(facts.ownerLocale).toBe("en");
        expect(replyEligibility(facts, { trigger: "auto", now: NOW })).toEqual({ ok: false, reason: "language" });
        expect(replyEligibility(facts, { trigger: "tap", now: NOW })).toEqual({ ok: true, language: "en" });
      }
    });
  });

  test("the newest result decides the category and the language", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const id = await insertTriaged(trx, ctx, mailboxId, {
        category: "info",
        createdAt: new Date(NOW.getTime() - 3 * HOUR_MS),
        from: "anna@client.test",
        fields: { language: "en" },
      });
      await captured(trx, ctx.orgId, id);
      await trx
        .insertInto("triage_results")
        .values({
          org_id: ctx.orgId,
          email_id: id,
          category: "needs_reply",
          confidence: 0.9,
          reason_code: "direct_request",
          fields: JSON.stringify({ language: "pl" }),
          created_at: new Date(NOW.getTime() - HOUR_MS),
        })
        .execute();
      const { facts } = pick(await loadReplyFacts(trx, ctx, [id], { ownerLocale: null }), id);
      expect(facts).toMatchObject({ category: "needs_reply", language: "pl" });
    });
  });

  test("a mail of another organization is absent; the sender that is an own mailbox is own_mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const foreign = await insertTriaged(trx, b.ctx, b.mailboxId, { category: "needs_reply", createdAt: NOW });
      const ownAddress = (
        await trx.selectFrom("mailboxes").select("address").where("id", "=", a.mailboxId).executeTakeFirstOrThrow()
      ).address;
      const own = await insertTriaged(trx, a.ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        from: ownAddress.toUpperCase(),
        fields: { language: "pl" },
      });
      await captured(trx, a.ctx.orgId, own);
      const loaded = await loadReplyFacts(trx, a.ctx, [foreign, own], { ownerLocale: null });
      expect([...loaded.keys()]).toEqual([own]);
      expect(replyEligibility(pick(loaded, own).facts, { trigger: "tap", now: NOW })).toEqual({
        ok: false,
        reason: "own_mailbox",
      });
    });
  });

  test("no ids give an empty map", async () => {
    await withRollback(db, async (trx) => {
      const { ctx } = await setup(trx);
      expect((await loadReplyFacts(trx, ctx, [], { ownerLocale: null })).size).toBe(0);
    });
  });
});
