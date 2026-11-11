import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type KyselyPlugin, type Transaction } from "kysely";

import { listLatestDelegationsByEmailIds } from "../../src/modules/delegation";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { insertFeedback, listActivityRows, listLatestFeedbackByEmailIds } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-11T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SINCE = new Date(NOW.getTime() - 7 * DAY);

const query = { notRated: false, since: SINCE, limit: 50 };

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, b, ctxA: { orgId: a.orgId }, ctxB: { orgId: b.orgId } };
}

function ids(rows: { email_id: string }[]): string[] {
  return rows.map((row) => row.email_id);
}

async function ageFeedback(trx: Transaction<DB>): Promise<void> {
  await trx
    .updateTable("triage_feedback")
    .set({ created_at: sql`created_at - interval '1 minute'` })
    .execute();
}

// Counts every query that goes through the executor (builder and raw `sql`), for the zero-query checks.
function countingPlugin() {
  const counter = { count: 0 };
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      counter.count += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { counter, plugin };
}

describe("listActivityRows", () => {
  test("filters by organization and returns the newest mail first", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const m1 = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - 3 * HOUR),
      });
      const m2 = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - 1 * HOUR),
      });
      const m3 = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "urgent",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - 2 * HOUR),
      });
      const o1 = await insertTriaged(trx, ctxB, b.mailboxId, { category: "info", createdAt: NOW });
      const o2 = await insertTriaged(trx, ctxB, b.mailboxId, { category: "info", createdAt: NOW });

      const rowsA = await listActivityRows(trx, ctxA, query);
      expect(ids(rowsA)).toEqual([m2, m3, m1]);
      const rowsB = await listActivityRows(trx, ctxB, query);
      expect(ids(rowsB).sort()).toEqual([o1, o2].sort());
      expect(rowsA[0]?.mailbox_id).toBe(a.mailboxId);
      expect(rowsA[0]?.folder).toBe("INBOX");
    });
  });

  test("uses the latest triage result of a mail", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const emailId = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: new Date(NOW.getTime() - HOUR),
        receivedAt: new Date(NOW.getTime() - 2 * HOUR),
      });
      await trx
        .insertInto("triage_results")
        .values({
          org_id: a.orgId,
          email_id: emailId,
          category: "urgent",
          confidence: 0.7,
          reason_code: "model",
          reason: "later",
          model: "m",
          prompt_version: "v",
          fields: JSON.stringify({}),
          created_at: new Date(NOW.getTime() - HOUR + MINUTE),
        })
        .execute();

      const all = await listActivityRows(trx, ctxA, query);
      expect(all).toHaveLength(1);
      expect(all[0]?.category).toBe("urgent");
      expect(all[0]?.triaged_at.getTime()).toBe(NOW.getTime() - HOUR + MINUTE);
      expect(await listActivityRows(trx, ctxA, { ...query, categories: ["info"] })).toEqual([]);
      expect(ids(await listActivityRows(trx, ctxA, { ...query, categories: ["urgent"] }))).toEqual([emailId]);
    });
  });

  test("honours the window and skips a mail with no triage result", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - 8 * DAY),
      });
      const m6 = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - 6 * DAY),
      });
      const m1 = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date(NOW.getTime() - HOUR),
      });
      await insertTestEmail(trx, ctxA, a.mailboxId, { status: "pending", received_at: new Date(NOW.getTime() - HOUR) });

      expect(ids(await listActivityRows(trx, ctxA, query))).toEqual([m1, m6]);
    });
  });

  test("filters by mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA } = await setup(trx);
      const second = randomUUID();
      await insertMailbox(trx, ctxA, {
        id: second,
        address: `second-${second}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertInboxFolder(trx, ctxA, second);
      const m1 = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW });
      const m2 = await insertTriaged(trx, ctxA, second, { category: "info", createdAt: NOW });

      expect(ids(await listActivityRows(trx, ctxA, { ...query, mailboxId: second }))).toEqual([m2]);
      expect(ids(await listActivityRows(trx, ctxA, { ...query, mailboxId: a.mailboxId }))).toEqual([m1]);
      expect(await listActivityRows(trx, ctxA, { ...query, mailboxId: b.mailboxId })).toEqual([]);
    });
  });

  test("pages with the cursor over equal timestamps: each mail once, id descending", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const same = new Date(NOW.getTime() - HOUR);
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        created.push(
          await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW, receivedAt: same })
        );
      }
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: { receivedAtKey: string; id: string } | undefined;
      for (let page = 0; page < 3; page += 1) {
        const rows = await listActivityRows(trx, ctxA, { ...query, limit: 2, cursor });
        sizes.push(rows.length);
        seen.push(...ids(rows));
        const last = rows[rows.length - 1];
        cursor = last ? { receivedAtKey: last.received_at_key, id: last.email_id } : undefined;
      }
      expect(sizes).toEqual([2, 2, 1]);
      expect([...seen].sort()).toEqual([...created].sort());
      expect(seen).toEqual([...created].sort().reverse());
    });
  });

  test("keeps the microseconds of received_at in the key and the cursor", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const older = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date("2026-11-11T10:00:00.000Z"),
      });
      const target = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: NOW,
        receivedAt: new Date("2026-11-11T10:00:00.000Z"),
      });
      await trx
        .updateTable("emails")
        .set({ received_at: sql`'2026-11-11 10:00:00.123456+00'::timestamptz` })
        .where("id", "=", target)
        .execute();

      const rows = await listActivityRows(trx, ctxA, query);
      expect(ids(rows)).toEqual([target, older]);
      expect(rows[0]?.received_at_key).toBe("2026-11-11T10:00:00.123456Z");

      const next = await listActivityRows(trx, ctxA, {
        ...query,
        cursor: { receivedAtKey: rows[0]?.received_at_key ?? "", id: target },
      });
      expect(ids(next)).toEqual([older]);
    });
  });

  test("notRated leaves out a mail with a feedback row", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const rated = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW });
      const open = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW });
      await insertFeedback(trx, ctxA, {
        emailId: rated,
        verdict: "right",
        trueCategory: "info",
        source: "web",
        userId: a.userId,
      });

      expect(ids(await listActivityRows(trx, ctxA, { ...query, notRated: true }))).toEqual([open]);
      expect(ids(await listActivityRows(trx, ctxA, query)).sort()).toEqual([rated, open].sort());
    });
  });

  test("an empty category list gives no rows", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW });
      expect(await listActivityRows(trx, ctxA, { ...query, categories: [] })).toEqual([]);
    });
  });

  test("model_category: a category value, or null for an unknown text", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const good = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "unsure",
        createdAt: NOW,
        fields: { model_category: "info" },
      });
      const bad = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "unsure",
        createdAt: NOW,
        fields: { model_category: "bogus" },
      });
      const rows = await listActivityRows(trx, ctxA, query);
      expect(rows.find((row) => row.email_id === good)?.model_category).toBe("info");
      expect(rows.find((row) => row.email_id === bad)?.model_category).toBeNull();
    });
  });

  test("maps the stored columns of the mail and its result", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const emailId = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "needs_reply",
        createdAt: NOW,
        confidence: 0.81,
        reason: "The sender asks for a date.",
        reasonCode: "model",
        subject: "Subject",
        from: "sender@x.test",
      });
      const [row] = await listActivityRows(trx, ctxA, query);
      expect(row).toMatchObject({
        email_id: emailId,
        category: "needs_reply",
        confidence: 0.81,
        reason_code: "model",
        reason: "The sender asks for a date.",
        subject: "Subject",
        from_address: "sender@x.test",
        model_category: null,
      });
    });
  });
});

describe("listLatestFeedbackByEmailIds", () => {
  test("returns the newer of two rows, skips another organization, and runs no query for []", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const mine = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: NOW });
      const foreign = await insertTriaged(trx, ctxB, b.mailboxId, { category: "info", createdAt: NOW });
      await insertFeedback(trx, ctxA, {
        emailId: mine,
        verdict: "wrong",
        trueCategory: "urgent",
        source: "telegram",
        userId: a.userId,
      });
      await ageFeedback(trx);
      await insertFeedback(trx, ctxA, {
        emailId: mine,
        verdict: "right",
        trueCategory: "info",
        source: "web",
        userId: a.userId,
      });
      await insertFeedback(trx, ctxB, {
        emailId: foreign,
        verdict: "right",
        trueCategory: "info",
        source: "web",
        userId: b.userId,
      });

      const map = await listLatestFeedbackByEmailIds(trx, ctxA, [mine, foreign]);
      expect([...map.keys()]).toEqual([mine]);
      expect(map.get(mine)).toMatchObject({ verdict: "right", true_category: "info", source: "web" });
      expect(map.get(mine)?.created_at).toBeInstanceOf(Date);

      const { counter, plugin } = countingPlugin();
      expect((await listLatestFeedbackByEmailIds(trx.withPlugin(plugin), ctxA, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});

describe("listLatestDelegationsByEmailIds", () => {
  test("returns status, due date and delegate name; the newer of two rows; no other organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const dueAt = new Date(NOW.getTime() + 2 * DAY);
      const ola = await insertDelegate(trx, ctxA, { name: "Ola" });
      const first = await insertDraftAndSend(trx, ctxA, a.mailboxId, { delegateId: ola, delegateName: "Ola" });
      await insertDelegation(trx, ctxA, {
        mailboxId: a.mailboxId,
        emailId: first.emailId,
        delegateId: ola,
        draftActionId: first.draftId,
        sendActionId: first.sendId,
        status: "drafted",
        dueAt,
      });

      const second = await insertDraftAndSend(trx, ctxA, a.mailboxId, { delegateId: ola, delegateName: "Ola" });
      await insertDelegation(trx, ctxA, {
        mailboxId: a.mailboxId,
        emailId: second.emailId,
        delegateId: ola,
        draftActionId: second.draftId,
        sendActionId: second.sendId,
        status: "drafted",
        createdAt: new Date(NOW.getTime() - MINUTE),
      });
      const secondSend = await insertAction(trx, ctxA, second.emailId, { type: "send", status: "awaiting_approval" });
      await insertDelegation(trx, ctxA, {
        mailboxId: a.mailboxId,
        emailId: second.emailId,
        delegateId: ola,
        draftActionId: second.draftId,
        sendActionId: secondSend,
        status: "cancelled",
        createdAt: NOW,
      });

      const bob = await insertDelegate(trx, ctxB, { name: "Bob" });
      const foreign = await insertDraftAndSend(trx, ctxB, b.mailboxId, { delegateId: bob, delegateName: "Bob" });
      await insertDelegation(trx, ctxB, {
        mailboxId: b.mailboxId,
        emailId: foreign.emailId,
        delegateId: bob,
        draftActionId: foreign.draftId,
        sendActionId: foreign.sendId,
      });

      const map = await listLatestDelegationsByEmailIds(trx, ctxA, [first.emailId, second.emailId, foreign.emailId]);
      expect([...map.keys()].sort()).toEqual([first.emailId, second.emailId].sort());
      expect(map.get(first.emailId)).toEqual({ status: "drafted", due_at: dueAt, delegate_name: "Ola" });
      expect(map.get(second.emailId)?.status).toBe("cancelled");

      const { counter, plugin } = countingPlugin();
      expect((await listLatestDelegationsByEmailIds(trx.withPlugin(plugin), ctxA, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});
