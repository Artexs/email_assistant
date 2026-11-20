import type { Category } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import type { SenderWindowOptions } from "../../src/modules/mail";
import { newestFeedbackBySender, newestResultsBySender } from "../../src/modules/triage";

import { ago, newOrg, NOW, type Org, type Trx } from "./contacts-fixtures";
import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The triage readers of the sender activity pass: the newest result and the newest feedback of each mail of the window. The
// values are fixed; the tenant test calls each reader with the context of one organization and the mailbox of another.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const DAY = 86_400_000;
const ADDRESS = "x@example.com";
const LOW_ID = "00000000-0000-4000-8000-000000000001";
const HIGH_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const window = (mailboxId: string): SenderWindowOptions => ({
  mailboxId,
  since: new Date(NOW.getTime() - 90 * DAY),
  until: NOW,
  testMail: { senders: [] },
});

const mail = (trx: Trx, org: Org, at: Date, address = ADDRESS): Promise<string> =>
  insertTestEmail(trx, org.ctx, org.mailboxId, {
    status: "triaged",
    received_at: at,
    from_address: address,
    message_id_header: `<${crypto.randomUUID()}@x.test>`,
  });

const result = (
  trx: Trx,
  org: Org,
  emailId: string,
  category: Category,
  at: Date,
  over: { suspicious?: boolean; id?: string } = {}
) =>
  trx
    .insertInto("triage_results")
    .values({
      ...(over.id === undefined ? {} : { id: over.id }),
      org_id: org.ctx.orgId,
      email_id: emailId,
      category,
      confidence: 0.9,
      reason_code: "direct_request",
      suspicious_reasons: over.suspicious === true ? ["lookalike_domain"] : [],
      created_at: at,
    })
    .execute();

const feedback = (
  trx: Trx,
  org: Org,
  emailId: string,
  at: Date,
  row: { verdict: "right" | "wrong"; trueCategory?: Category; source?: "web" | "imap_move" }
) =>
  trx
    .insertInto("triage_feedback")
    .values({
      org_id: org.ctx.orgId,
      email_id: emailId,
      verdict: row.verdict,
      true_category: row.trueCategory ?? null,
      source: row.source ?? "web",
      created_at: at,
    })
    .execute();

const hours = (base: Date, count: number): Date => new Date(base.getTime() + count * 3_600_000);

describe("newestResultsBySender", () => {
  test("1 the newest result of a mail counts once, with its suspicious reasons", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const first = await mail(trx, org, ago(5));
      await result(trx, org, first, "spam", ago(5));
      await result(trx, org, first, "info", hours(ago(5), 1));
      const second = await mail(trx, org, ago(6));
      await result(trx, org, second, "info", ago(6), { suspicious: true });
      await mail(trx, org, ago(7));
      const rows = await newestResultsBySender(trx, org.ctx, window(org.mailboxId));
      expect(rows).toEqual([{ address: ADDRESS, category: "info", mails: 2, suspicious: 1 }]);
    });
  });

  test("2 two results with the same created_at: the higher id wins", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await mail(trx, org, ago(5));
      // The higher id goes in first, so the insert order cannot decide.
      await result(trx, org, id, "spam", ago(4), { id: HIGH_ID });
      await result(trx, org, id, "info", ago(4), { id: LOW_ID });
      const rows = await newestResultsBySender(trx, org.ctx, window(org.mailboxId));
      expect(rows).toEqual([{ address: ADDRESS, category: "spam", mails: 1, suspicious: 0 }]);
    });
  });

  test("3 a mail at 91 days is not counted; one per category and address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await mail(trx, org, ago(91));
      await result(trx, org, old, "info", ago(91));
      const recent = await mail(trx, org, ago(89));
      await result(trx, org, recent, "urgent", ago(89));
      const other = await mail(trx, org, ago(3), "y@example.com");
      await result(trx, org, other, "urgent", ago(3));
      const rows = await newestResultsBySender(trx, org.ctx, window(org.mailboxId));
      expect([...rows].sort((p, q) => (p.address < q.address ? -1 : 1))).toEqual([
        { address: ADDRESS, category: "urgent", mails: 1, suspicious: 0 },
        { address: "y@example.com", category: "urgent", mails: 1, suspicious: 0 },
      ]);
    });
  });

  test("4 another organization's rows never count; its mailbox gives nothing for this context", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mineMail = await mail(trx, a, ago(5));
      await result(trx, a, mineMail, "info", ago(5));
      const theirs = await mail(trx, b, ago(5));
      await result(trx, b, theirs, "spam", ago(5));
      expect(await newestResultsBySender(trx, a.ctx, window(a.mailboxId))).toEqual([
        { address: ADDRESS, category: "info", mails: 1, suspicious: 0 },
      ]);
      expect(await newestResultsBySender(trx, a.ctx, window(b.mailboxId))).toEqual([]);
    });
  });
});

describe("newestFeedbackBySender", () => {
  test("1 the newest feedback of a mail counts one correction, to its true category", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await mail(trx, org, ago(5));
      await result(trx, org, id, "info", ago(5));
      await feedback(trx, org, id, ago(4), { verdict: "wrong", trueCategory: "spam" });
      await feedback(trx, org, id, ago(3), { verdict: "wrong", trueCategory: "needs_reply" });
      const rows = await newestFeedbackBySender(trx, org.ctx, window(org.mailboxId));
      expect(rows).toEqual([{ address: ADDRESS, kind: "correction", category: "needs_reply", mails: 1 }]);
    });
  });

  test("2 two feedback rows with the same created_at: the higher id wins", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await mail(trx, org, ago(5));
      await trx
        .insertInto("triage_feedback")
        .values([
          {
            id: HIGH_ID,
            org_id: org.ctx.orgId,
            email_id: id,
            verdict: "wrong",
            true_category: "spam",
            source: "web",
            created_at: ago(4),
          },
          {
            id: LOW_ID,
            org_id: org.ctx.orgId,
            email_id: id,
            verdict: "wrong",
            true_category: "info",
            source: "web",
            created_at: ago(4),
          },
        ])
        .execute();
      const rows = await newestFeedbackBySender(trx, org.ctx, window(org.mailboxId));
      expect(rows).toEqual([{ address: ADDRESS, kind: "correction", category: "spam", mails: 1 }]);
    });
  });

  test("3 rescued: a spam mail corrected to info; a moved-back info mail is moved back only", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const spam = await mail(trx, org, ago(5));
      await result(trx, org, spam, "spam", ago(5));
      await feedback(trx, org, spam, ago(4), { verdict: "wrong", trueCategory: "info" });
      const moved = await mail(trx, org, ago(6));
      await result(trx, org, moved, "info", ago(6));
      await feedback(trx, org, moved, ago(5), { verdict: "wrong", source: "imap_move" });
      const rows = await newestFeedbackBySender(trx, org.ctx, window(org.mailboxId));
      const key = (row: (typeof rows)[number]) => `${row.kind}:${row.category ?? ""}`;
      expect(rows.map((row) => ({ ...row, key: key(row) })).sort((p, q) => (p.key < q.key ? -1 : 1))).toEqual([
        { address: ADDRESS, kind: "correction", category: "info", mails: 1, key: "correction:info" },
        { address: ADDRESS, kind: "moved_back", category: null, mails: 1, key: "moved_back:" },
        { address: ADDRESS, kind: "rescued", category: null, mails: 1, key: "rescued:" },
      ]);
    });
  });

  test("4 a mail at 91 days is not counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await mail(trx, org, ago(91));
      await result(trx, org, id, "spam", ago(91));
      await feedback(trx, org, id, ago(90), { verdict: "wrong", source: "imap_move" });
      expect(await newestFeedbackBySender(trx, org.ctx, window(org.mailboxId))).toEqual([]);
    });
  });

  test("5 another organization's rows never count; its mailbox gives nothing for this context", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mine = await mail(trx, a, ago(5));
      await feedback(trx, a, mine, ago(4), { verdict: "wrong", trueCategory: "info" });
      const theirs = await mail(trx, b, ago(5));
      await result(trx, b, theirs, "spam", ago(5));
      await feedback(trx, b, theirs, ago(4), { verdict: "wrong", source: "imap_move" });
      expect(await newestFeedbackBySender(trx, a.ctx, window(a.mailboxId))).toEqual([
        { address: ADDRESS, kind: "correction", category: "info", mails: 1 },
      ]);
      expect(await newestFeedbackBySender(trx, a.ctx, window(b.mailboxId))).toEqual([]);
    });
  });
});
