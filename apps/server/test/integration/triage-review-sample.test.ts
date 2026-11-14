import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertTriageResult, listForReview, listReviewSample, recordFeedback } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T12:00:00Z");
const SINCE = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
const TEST_SENDER = "t@agentmail.test";
const RULE = { senders: [TEST_SENDER] };

interface Tenant {
  orgId: string;
  mailboxId: string;
}

async function triagedMail(
  trx: Transaction<DB>,
  tenant: Tenant,
  overrides: { id?: string; receivedAt: Date; from?: string; messageId?: string }
): Promise<string> {
  const emailId = await insertTestEmail(trx, { orgId: tenant.orgId }, tenant.mailboxId, {
    ...(overrides.id ? { id: overrides.id } : {}),
    received_at: overrides.receivedAt,
    from_address: overrides.from ?? "a@x.test",
    message_id_header: overrides.messageId ?? `<${crypto.randomUUID()}@x.test>`,
  });
  await insertTriageResult(
    trx,
    { orgId: tenant.orgId },
    {
      emailId,
      category: "info",
      vip: false,
      confidence: 0.9,
      reasonCode: "llm",
      reason: null,
      fields: {},
      model: "gemini-3.5-flash-lite",
      promptVersion: "classifier-v1",
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
    }
  );
  return emailId;
}

// Fixed ids make the md5 order a fixed list: the tests pin it.
const mailId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Org A: 14 triaged mails (index 1..14). Mail 1 is outside the window, 3 has a label, 5 is from a test sender, 7 has a synthetic Message-ID.
async function seed(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  const ids: string[] = [];
  for (let n = 1; n <= 14; n += 1) {
    const day = String(n).padStart(2, "0");
    ids.push(
      await triagedMail(trx, a, {
        id: mailId(n),
        receivedAt: n === 1 ? new Date("2026-10-15T09:00:00Z") : new Date(`2026-11-${day}T09:00:00Z`),
        from: n === 5 ? TEST_SENDER : undefined,
        messageId: n === 7 ? "<s@ea-seed.test>" : undefined,
      })
    );
  }
  await recordFeedback(trx, { orgId: a.orgId }, { emailId: ids[2] as string, trueCategory: "info", source: "review" });
  for (let n = 1; n <= 3; n += 1) {
    await triagedMail(trx, b, { receivedAt: new Date(`2026-11-1${n}T09:00:00Z`) });
  }
  const mail = (n: number) => ids[n - 1] as string;
  const eligible = [2, 4, 6, 8, 9, 10, 11, 12, 13, 14].map(mail);
  return { a, b, mail, eligible };
}

const num = (id: string) => Number(id.slice(-12));

function sample(trx: Transaction<DB>, tenant: Tenant, seedText: string, limit = 10) {
  return listReviewSample(
    trx,
    { orgId: tenant.orgId },
    { mailboxIds: [tenant.mailboxId], since: SINCE, seed: seedText, limit, testMail: RULE }
  );
}

describe("listReviewSample", () => {
  test("returns only unlabelled real mail of the window, none of another org", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const rows = await sample(trx, s.a, "s1");
      expect(rows).toHaveLength(10);
      expect(rows.map((row) => row.email_id).sort()).toEqual([...s.eligible].sort());
      for (const excluded of [1, 3, 5, 7]) {
        expect(rows.map((row) => row.email_id)).not.toContain(s.mail(excluded));
      }
    });
  });

  test("one seed gives one order, another seed another order", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const first = (await sample(trx, s.a, "s1")).map((row) => row.email_id);
      const again = (await sample(trx, s.a, "s1")).map((row) => row.email_id);
      const other = (await sample(trx, s.a, "s2")).map((row) => row.email_id);
      expect(again).toEqual(first);
      expect([...other].sort()).toEqual([...first].sort());
      expect(first.map(num)).toEqual([10, 9, 6, 13, 2, 11, 12, 4, 8, 14]);
      expect(other.map(num)).toEqual([8, 9, 13, 2, 14, 11, 12, 10, 6, 4]);
    });
  });

  test("a limit of 3 gives the first 3 of the full order", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const full = (await sample(trx, s.a, "s1")).map((row) => row.email_id);
      const three = (await sample(trx, s.a, "s1", 3)).map((row) => row.email_id);
      expect(three).toEqual(full.slice(0, 3));
    });
  });

  test("the context of another org sees nothing of a mailbox it does not own; an empty list is []", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const crossed = await listReviewSample(
        trx,
        { orgId: s.b.orgId },
        { mailboxIds: [s.a.mailboxId], since: SINCE, seed: "s1", limit: 10, testMail: RULE }
      );
      expect(crossed).toEqual([]);
      const none = await listReviewSample(
        trx,
        { orgId: s.a.orgId },
        { mailboxIds: [], since: SINCE, seed: "s1", limit: 10, testMail: RULE }
      );
      expect(none).toEqual([]);
      const ownB = await sample(trx, s.b, "s1");
      expect(ownB).toHaveLength(3);
    });
  });

  test("a mail with two triage results is one row with the latest category", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const emailId = await triagedMail(trx, a, { receivedAt: new Date("2026-11-10T09:00:00Z") });
      await trx
        .insertInto("triage_results")
        .values({
          org_id: a.orgId,
          email_id: emailId,
          category: "spam",
          vip: false,
          confidence: 0.8,
          reason_code: "llm",
          fields: "{}",
          created_at: new Date(Date.now() + 60_000),
        })
        .execute();
      const rows = await sample(trx, a, "s1");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ email_id: emailId, category: "spam" });
    });
  });
});

describe("listForReview", () => {
  test("adds the summary, looks back 30 days from now and pages by 10", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const items = await listForReview(
        trx,
        { orgId: s.a.orgId },
        {
          mailboxIds: [s.a.mailboxId],
          now: NOW,
          seed: "s1",
          testMail: RULE,
        }
      );
      expect(items).toHaveLength(10);
      expect(items.map((item) => item.emailId).sort()).toEqual([...s.eligible].sort());
      expect(items[0]).toMatchObject({ category: "info", summary: null, modelCategory: null });
    });
  });
});
