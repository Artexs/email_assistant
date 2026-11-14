import { afterAll, describe, expect, test } from "bun:test";

import { createPlanned } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import { markSynced } from "../../src/modules/mail/repo";
import {
  buildDigestMessage,
  digestPeriodStart,
  insertDigest,
  lastDigestSlotKey,
  lastSentDigestEnd,
  markDigestSent,
} from "../../src/modules/reports";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T07:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(T.getTime() + offset);

describe("digest rows", () => {
  test("insert, slot keys, sent end, tenant scope", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const row = { userId: a.userId, periodStart: at(-15 * HOUR), periodEnd: T };
      const id = await insertDigest(trx, ctx, { ...row, slotKey: "2026-11-06T08:00" });
      expect(id).toBeString();
      expect(await insertDigest(trx, ctx, { ...row, slotKey: "2026-11-06T08:00" })).toBeNull();
      await insertDigest(trx, ctx, { ...row, slotKey: "2026-11-05T16:00" });
      expect(await lastDigestSlotKey(trx, ctx, a.userId)).toBe("2026-11-06T08:00");

      expect(await lastSentDigestEnd(trx, ctx, a.userId)).toBeNull();
      expect(await markDigestSent(trx, ctx, id as string, at(MIN))).toBe(true);
      expect(await lastSentDigestEnd(trx, ctx, a.userId)).toEqual(T);
      expect(await markDigestSent(trx, ctx, id as string, at(2 * MIN))).toBe(false);

      const other = { orgId: b.orgId };
      expect(await lastDigestSlotKey(trx, other, a.userId)).toBeNull();
      expect(await lastSentDigestEnd(trx, other, a.userId)).toBeNull();
      expect(await markDigestSent(trx, other, id as string, at(MIN))).toBe(false);
    });
  });
});

describe("digestPeriodStart", () => {
  test("first digest, last sent end, and the 7-day cap", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const member = { userId: a.userId, linkedAt: at(-2 * HOUR) };
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-26 * HOUR));

      const id = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-11-05T16:00",
        periodStart: at(-20 * HOUR),
        periodEnd: at(-8 * HOUR),
      });
      // A digest that was never sent does not move the start.
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-26 * HOUR));
      await markDigestSent(trx, ctx, id as string, at(-8 * HOUR));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-8 * HOUR));

      // An older period end does not win over the greatest one.
      const old = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-11-07T08:00",
        periodStart: at(-11 * DAY),
        periodEnd: at(-10 * DAY),
      });
      await markDigestSent(trx, ctx, old as string, at(-10 * DAY));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-8 * HOUR));
    });
  });

  test("the cap and a clock jump", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const member = { userId: a.userId, linkedAt: at(-30 * DAY) };
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-7 * DAY));
      const future = { userId: a.userId, linkedAt: at(5 * DAY) };
      expect(await digestPeriodStart(trx, ctx, future, T)).toEqual(T);

      // A sent digest that ended 10 days ago: the start is still at most 7 days back.
      const old = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-10-27T08:00",
        periodStart: at(-11 * DAY),
        periodEnd: at(-10 * DAY),
      });
      await markDigestSent(trx, ctx, old as string, at(-10 * DAY));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-7 * DAY));
    });
  });
});

describe("buildDigestMessage", () => {
  const request = {
    kind: "scheduled" as const,
    periodStart: at(-15 * HOUR),
    periodEnd: T,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    now: T,
    locale: "en" as const,
  };

  test("lines, buttons, sync time, no data of another org", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      await markSynced(trx, ctx, a.mailboxId, at(-5 * MIN));

      const urgentId = await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-2 * HOUR),
        subject: "MARKER-SUBJECT-A",
        from: "boss@x.test",
        reason: "MARKER-REASON",
      });
      await createPlanned(trx, ctx, urgentId, [
        { type: "flag", status: "logged", idempotencyKey: `flag:${urgentId}`, payload: {} },
      ]);
      const infoId = await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-3 * HOUR),
        subject: "News",
        from: "news@x.test",
      });
      await createPlanned(trx, ctx, infoId, [
        {
          type: "save_summary",
          status: "ready",
          idempotencyKey: `sum:${infoId}`,
          payload: { summary: "MARKER-SUMMARY" },
        },
        { type: "move", status: "logged", idempotencyKey: `move:${infoId}`, payload: { folder: "ai_info" } },
      ]);
      await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, {
        category: "urgent",
        createdAt: at(-2 * HOUR),
        subject: "MARKER-SUBJECT-B",
      });

      const message = await buildDigestMessage(trx, ctx, request);
      expect(message.text).toContain("1. 🔴 Urgent ·");
      expect(message.text).toContain("MARKER-SUBJECT-A");
      expect(message.text).toContain("💬 MARKER-REASON");
      expect(message.text).toContain("→ would flag");
      expect(message.text).toContain("💬 MARKER-SUMMARY");
      expect(message.text).toContain("→ would move to AI/Info");
      expect(message.text).toContain("🔄 Last sync 07:55");
      expect(message.text).not.toContain("MARKER-SUBJECT-B");
      const firstRow = message.buttons[0]?.map((button) => button.data);
      expect(firstRow).toContain(`fr:u:${urgentId}`);
      expect(firstRow).toContain(`fe:${urgentId}`);
    });
  });

  test("the undo button shows for an applied move inside the window only", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      const mail = async (subject: string) =>
        insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-2 * HOUR), subject });
      const fresh = await mail("fresh");
      await insertAction(trx, ctx, fresh, { type: "move", status: "applied", appliedAt: at(-HOUR) });
      const reversed = await mail("reversed");
      const original = await insertAction(trx, ctx, reversed, {
        type: "move",
        status: "applied",
        appliedAt: at(-HOUR),
      });
      await insertAction(trx, ctx, reversed, { type: "move", status: "ready", reversesActionId: original });
      const old = await mail("old");
      await insertAction(trx, ctx, old, { type: "move", status: "applied", appliedAt: at(-8 * DAY) });

      const message = await buildDigestMessage(trx, ctx, request);
      const data = message.buttons.flat().map((button) => button.data);
      expect(data).toContain(`fu:${fresh}`);
      expect(data).not.toContain(`fu:${reversed}`);
      expect(data).not.toContain(`fu:${old}`);
    });
  });

  test("a result before the period does not show and is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      await markSynced(trx, ctx, a.mailboxId, at(-5 * MIN));
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-16 * HOUR),
        subject: "MARKER-SUBJECT-A",
      });
      const message = await buildDigestMessage(trx, ctx, request);
      expect(message.text).not.toContain("MARKER-SUBJECT-A");
      expect(message.text).toContain("No new mail since");
      expect(message.text).toContain("🔄 Last sync 07:55");
      expect(message.buttons).toEqual([]);
    });
  });

  test("not processed and waiting counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.emailSkipped,
        reasonCode: "too_old",
        at: at(-HOUR),
      });
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-DAY) });
      const message = await buildDigestMessage(trx, ctx, request);
      expect(message.text).toContain("📭 Not processed (older than 7 days): 1");
      expect(message.text).toContain("⏳ Waiting for triage: 1");
    });
  });

  test("skipped mail is counted by reason_code: too_old and suspended_backlog have their own lines", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      for (const reasonCode of ["too_old", "suspended_backlog"]) {
        await recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.emailSkipped,
          reasonCode,
          at: at(-HOUR),
        });
      }
      const message = await buildDigestMessage(trx, ctx, request);
      expect(message.text).toContain("(older than 7 days): 1");
      expect(message.text).toContain("(from the account pause): 1");
    });
  });

  test("the folder tag and the stay folder come from the mail's folders", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-2 * HOUR),
        subject: "MARKER-OFFER",
        folder: "Oferty",
        sourceFolder: "Oferty",
        uid: 11,
        actions: [],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-3 * HOUR),
        subject: "MARKER-RESCUED",
        folder: "INBOX",
        sourceFolder: "Wiadomości-śmieci",
        uid: 12,
        actions: [{ type: "move", status: "applied", payload: { folder: "inbox" } }],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-5 * HOUR),
        subject: "MARKER-JUNK-URGENT",
        folder: "Wiadomości-śmieci",
        sourceFolder: "Wiadomości-śmieci",
        uid: 14,
        actions: [],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-4 * HOUR),
        subject: "MARKER-PLAIN",
        uid: 13,
        actions: [],
      });

      const message = await buildDigestMessage(trx, ctx, request);
      const block = (marker: string) => {
        const lines = message.text.split("\n");
        const index = lines.findIndex((line) => line.includes(marker));
        return lines.slice(Math.max(0, index - 1), index + 4).join("\n");
      };
      expect(block("MARKER-OFFER")).toContain("📁 Oferty");
      expect(block("MARKER-OFFER")).toContain("→ stays in Oferty");
      expect(block("MARKER-RESCUED")).toContain("📁 Wiadomości-śmieci");
      expect(block("MARKER-RESCUED")).toContain("→ done: move to INBOX");
      expect(message.text.indexOf("NEEDS ACTION")).toBeGreaterThanOrEqual(0);
      expect(block("MARKER-JUNK-URGENT")).toContain("📁 Wiadomości-śmieci");
      expect(block("MARKER-JUNK-URGENT")).toContain("→ stays in Wiadomości-śmieci");
      expect(block("MARKER-PLAIN")).not.toContain("📁");
      expect(block("MARKER-PLAIN")).toContain("→ stays in INBOX");
    });
  });

  test("a synthetic message shows the test mark", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await insertTriaged(trx, { orgId: a.orgId }, a.mailboxId, {
        category: "info",
        createdAt: at(-HOUR),
        subject: "Seed",
        messageId: "<x@ea-seed.test>",
      });
      const message = await buildDigestMessage(trx, { orgId: a.orgId }, request);
      expect(message.text).toContain("🧪 test");
    });
  });

  test("a mailbox without settings is mode none: no shadow line", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await insertTriaged(trx, { orgId: a.orgId }, a.mailboxId, {
        category: "info",
        createdAt: at(-HOUR),
        subject: "Seed",
      });
      const message = await buildDigestMessage(trx, { orgId: a.orgId }, request);
      expect(message.text).not.toContain("Shadow mode");
    });
  });
});

describe("buildDigestMessage with delegations", () => {
  const request = {
    kind: "scheduled" as const,
    periodStart: at(-15 * HOUR),
    periodEnd: T,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    now: T,
    locale: "en" as const,
  };

  test("a delegation line shows the draft, the approval and the task; the footer counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      const anna = await insertDelegate(trx, ctx, { name: "Anna Nowak" });
      const pending = await insertDraftAndSend(trx, ctx, a.mailboxId, {
        delegateId: anna,
        delegateName: "Anna Nowak",
        task: "MARKER-TASK",
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: at(-2 * HOUR),
        subject: "Offer",
      });
      await trx
        .updateTable("triage_results")
        .set({ reason: "MARKER-REASON" })
        .where("email_id", "=", pending.emailId)
        .execute();

      const sentOne = await insertDraftAndSend(trx, ctx, a.mailboxId, { delegateId: anna, createdAt: at(-3 * HOUR) });
      await insertDelegation(trx, ctx, {
        mailboxId: a.mailboxId,
        emailId: sentOne.emailId,
        delegateId: anna,
        draftActionId: sentOne.draftId,
        sendActionId: sentOne.sendId,
        status: "sent",
      });
      const overdueOne = await insertDraftAndSend(trx, ctx, a.mailboxId, {
        delegateId: anna,
        createdAt: at(-4 * HOUR),
      });
      await insertDelegation(trx, ctx, {
        mailboxId: a.mailboxId,
        emailId: overdueOne.emailId,
        delegateId: anna,
        draftActionId: overdueOne.draftId,
        sendActionId: overdueOne.sendId,
        status: "overdue",
      });

      const message = await buildDigestMessage(trx, ctx, request);
      expect(message.text).toContain("will draft a delegation to Anna Nowak; waits for your approval");
      expect(message.text).toContain("💬 MARKER-TASK");
      expect(message.text).not.toContain("MARKER-REASON");
      expect(message.text).toContain("👥 Delegations: 1 waiting for a reply, 1 overdue");
    });
  });

  test("no delegations: no footer line; another organization does not count", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const other = { orgId: b.orgId };
      const delegate = await insertDelegate(trx, other);
      const row = await insertDraftAndSend(trx, other, b.mailboxId, { delegateId: delegate });
      await insertDelegation(trx, other, {
        mailboxId: b.mailboxId,
        emailId: row.emailId,
        delegateId: delegate,
        draftActionId: row.draftId,
        sendActionId: row.sendId,
        status: "sent",
      });
      await insertTriaged(trx, { orgId: a.orgId }, a.mailboxId, { category: "info", createdAt: at(-HOUR) });
      const message = await buildDigestMessage(trx, { orgId: a.orgId }, request);
      expect(message.text).not.toContain("Delegations");
    });
  });
});
