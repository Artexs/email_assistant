import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createPlanned } from "../../src/modules/actions";
import { auditEvents, recordAudit, recordLlmCall } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import { listDelegateTags } from "../../src/modules/delegation";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import {
  buildDigestMessage,
  digestPeriodStart,
  insertDigest,
  lastDigestSlotKey,
  lastSentDigestEnd,
  markDigestSent,
} from "../../src/modules/reports";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertAttachmentHeaders,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { seedWeek } from "./metrics-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T07:00:00Z");
const MIN = MINUTE_MS;
const at = (offset: number) => new Date(T.getTime() + offset);

describe("digest rows", () => {
  test("insert, slot keys, sent end, tenant scope", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const row = { userId: a.userId, periodStart: at(-15 * HOUR_MS), periodEnd: T };
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
      const member = { userId: a.userId, linkedAt: at(-2 * HOUR_MS) };
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-26 * HOUR_MS));

      const id = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-11-05T16:00",
        periodStart: at(-20 * HOUR_MS),
        periodEnd: at(-8 * HOUR_MS),
      });
      // A digest that was never sent does not move the start.
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-26 * HOUR_MS));
      await markDigestSent(trx, ctx, id as string, at(-8 * HOUR_MS));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-8 * HOUR_MS));

      // An older period end does not win over the greatest one.
      const old = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-11-07T08:00",
        periodStart: at(-11 * DAY_MS),
        periodEnd: at(-10 * DAY_MS),
      });
      await markDigestSent(trx, ctx, old as string, at(-10 * DAY_MS));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-8 * HOUR_MS));
    });
  });

  test("the cap and a clock jump", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const member = { userId: a.userId, linkedAt: at(-30 * DAY_MS) };
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-7 * DAY_MS));
      const future = { userId: a.userId, linkedAt: at(5 * DAY_MS) };
      expect(await digestPeriodStart(trx, ctx, future, T)).toEqual(T);

      // A sent digest that ended 10 days ago: the start is still at most 7 days back.
      const old = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-10-27T08:00",
        periodStart: at(-11 * DAY_MS),
        periodEnd: at(-10 * DAY_MS),
      });
      await markDigestSent(trx, ctx, old as string, at(-10 * DAY_MS));
      expect(await digestPeriodStart(trx, ctx, member, T)).toEqual(at(-7 * DAY_MS));
    });
  });
});

describe("buildDigestMessage", () => {
  const request = {
    kind: "scheduled" as const,
    periodStart: at(-15 * HOUR_MS),
    periodEnd: T,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    now: T,
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
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
        createdAt: at(-2 * HOUR_MS),
        subject: "MARKER-SUBJECT-A",
        from: "boss@x.test",
        reason: "MARKER-REASON",
      });
      await createPlanned(trx, ctx, urgentId, [
        { type: "flag", status: "logged", idempotencyKey: `flag:${urgentId}`, payload: {} },
      ]);
      const infoId = await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-3 * HOUR_MS),
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
        createdAt: at(-2 * HOUR_MS),
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
        insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-2 * HOUR_MS), subject });
      const fresh = await mail("fresh");
      await insertAction(trx, ctx, fresh, { type: "move", status: "applied", appliedAt: at(-HOUR_MS) });
      const reversed = await mail("reversed");
      const original = await insertAction(trx, ctx, reversed, {
        type: "move",
        status: "applied",
        appliedAt: at(-HOUR_MS),
      });
      await insertAction(trx, ctx, reversed, { type: "move", status: "ready", reversesActionId: original });
      const old = await mail("old");
      await insertAction(trx, ctx, old, { type: "move", status: "applied", appliedAt: at(-8 * DAY_MS) });

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
        createdAt: at(-16 * HOUR_MS),
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
        at: at(-HOUR_MS),
      });
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-DAY_MS) });
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
          at: at(-HOUR_MS),
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
        createdAt: at(-2 * HOUR_MS),
        subject: "MARKER-OFFER",
        folder: "Oferty",
        sourceFolder: "Oferty",
        uid: 11,
        actions: [],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-3 * HOUR_MS),
        subject: "MARKER-RESCUED",
        folder: "INBOX",
        sourceFolder: "Wiadomości-śmieci",
        uid: 12,
        actions: [{ type: "move", status: "applied", payload: { folder: "inbox" } }],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-5 * HOUR_MS),
        subject: "MARKER-JUNK-URGENT",
        folder: "Wiadomości-śmieci",
        sourceFolder: "Wiadomości-śmieci",
        uid: 14,
        actions: [],
      });
      await insertTriagedWithActions(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-4 * HOUR_MS),
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
        createdAt: at(-HOUR_MS),
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
        createdAt: at(-HOUR_MS),
        subject: "Seed",
      });
      const message = await buildDigestMessage(trx, { orgId: a.orgId }, request);
      expect(message.text).not.toContain("Shadow mode");
    });
  });

  test("the LLM pause line is the first footer line only with the flag llm_pause_line on", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-HOUR_MS), subject: "Seed" });
      await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-HOUR_MS), subject: "Seed 2" });
      await recordLlmCall(trx, ctx, {
        mailboxId: a.mailboxId,
        role: "classifier",
        promptVersion: "test",
        model: "test-model",
        endpoint: "standard",
        provider: "openai" as const,
        outcome: "http_429_quota",
        tokensIn: null,
        tokensOut: null,
        latencyMs: 5,
        at: at(-5 * MIN),
      });
      const wide = { ...request, kind: "on_demand" as const, slot: null };

      const off = await buildDigestMessage(trx, ctx, wide);
      expect(off.text).not.toContain("⏸ LLM");

      await setOrgFeature(trx, ctx, { flag: "llm_pause_line", enabled: true, actor: "cli", now: T });
      const on = await buildDigestMessage(trx, ctx, wide);
      expect(on.text).toContain(
        "⏸ LLM paused since 07:55: the provider quota or budget is spent (http_429_quota). Triage waits."
      );
    });
  });
});

describe("buildDigestMessage with delegations", () => {
  const request = {
    kind: "scheduled" as const,
    periodStart: at(-15 * HOUR_MS),
    periodEnd: T,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    now: T,
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
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
        createdAt: at(-2 * HOUR_MS),
        subject: "Offer",
      });
      await trx
        .updateTable("triage_results")
        .set({ reason: "MARKER-REASON" })
        .where("email_id", "=", pending.emailId)
        .execute();

      const sentOne = await insertDraftAndSend(trx, ctx, a.mailboxId, {
        delegateId: anna,
        createdAt: at(-3 * HOUR_MS),
      });
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
        createdAt: at(-4 * HOUR_MS),
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
      await insertTriaged(trx, { orgId: a.orgId }, a.mailboxId, { category: "info", createdAt: at(-HOUR_MS) });
      const message = await buildDigestMessage(trx, { orgId: a.orgId }, request);
      expect(message.text).not.toContain("Delegations");
    });
  });
});

describe("buildDigestMessage with the handled share", () => {
  const request = {
    kind: "on_demand" as const,
    periodStart: new Date("2026-11-20T08:00:00Z"),
    periodEnd: new Date("2026-11-21T08:00:00Z"),
    slot: null,
    now: new Date("2026-11-21T08:00:00Z"),
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
  };

  test("the line is behind the flag `handled_share`", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const off = await buildDigestMessage(trx, orgA.ctx, request);
      expect(off.text).not.toContain("🤖 Handled in the last 7 days:");

      await setOrgFeature(trx, orgA.ctx, { flag: "handled_share", enabled: true, actor: "cli", now: request.now });
      const on = await buildDigestMessage(trx, orgA.ctx, request);
      expect(on.text).toContain("🤖 Handled in the last 7 days:");
    });
  });
});

describe("buildDigestMessage: suspicious mail", () => {
  const request = {
    kind: "scheduled" as const,
    periodStart: at(-15 * HOUR_MS),
    periodEnd: T,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    now: T,
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
  };

  async function seed(trx: Transaction<DB>) {
    const a = await createOrgWithMailbox(trx);
    const b = await createOrgWithMailbox(trx);
    const ctx = { orgId: a.orgId };
    await insertDefaultSettings(trx, ctx, a.mailboxId);
    const draft = async (
      orgCtx: { orgId: string },
      mailboxId: string,
      subject: string,
      reasons: string[],
      withDraft = true
    ) => {
      const emailId = await insertTriaged(trx, orgCtx, mailboxId, {
        category: "delegation",
        createdAt: at(-2 * HOUR_MS),
        subject,
        suspiciousReasons: reasons,
      });
      if (withDraft) {
        await createPlanned(trx, orgCtx, emailId, [
          {
            type: "create_draft",
            status: "logged",
            idempotencyKey: `draft:${emailId}`,
            payload: { kind: "delegation" },
          },
        ]);
      }
      return emailId;
    };
    // A flagged mail that got no plan, and one that was drafted before the flag went on (it keeps its would-do line).
    await draft(ctx, a.mailboxId, "SUBJECT-A", ["link_mismatch"], false);
    await draft(ctx, a.mailboxId, "SUBJECT-DRAFTED", ["risky_attachment"]);
    // Organization B has a flagged mail too: it never shows in the digest of A.
    await draft({ orgId: b.orgId }, b.mailboxId, "SUBJECT-B", ["auth_fail"]);
    return { ctx, ctxB: { orgId: b.orgId } };
  }

  test("flag on: the warning line and the no-draft line; flag off: the digest of today", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, ctxB } = await seed(trx);
      const off = (await buildDigestMessage(trx, ctx, request)).text;
      expect(off).not.toContain("Suspicious");
      expect(off).not.toContain("no draft");
      expect(off).toContain("SUBJECT-DRAFTED\n→ would draft a delegation");

      await setOrgFeature(trx, ctx, { flag: "suspicious_mail", enabled: true, actor: "cli", now: T });
      const on = (await buildDigestMessage(trx, ctx, request)).text;
      expect(on).toContain("SUBJECT-A");
      expect(on).toContain("⚠ Suspicious: link goes elsewhere\n→ no draft: suspicious mail");
      expect(on).not.toContain("SUBJECT-B");
      expect(on).toContain("⚠ Suspicious: risky attachment\n→ would draft a delegation");
      expect(on.match(/no draft/g)).toHaveLength(1);
      expect(on).not.toContain("sender check failed");

      // The flag is per organization: B has it off, so its digest has no warning.
      const forB = (await buildDigestMessage(trx, ctxB, request)).text;
      expect(forB).toContain("SUBJECT-B");
      expect(forB).not.toContain("Suspicious");
    });
  });
});

describe("digest attachment line (F109 stage 06)", () => {
  const request = {
    kind: "on_demand" as const,
    periodStart: at(-3 * HOUR_MS),
    periodEnd: T,
    slot: null,
    now: T,
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
  };
  const pdf = { name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false };

  test("flag on: the line after the subject; flag off, no row, and another organization: no line", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      await insertDefaultSettings(trx, ctxB, b.mailboxId);
      const withFile = await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-2 * HOUR_MS),
        subject: "SUBJECT-FILE",
      });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-90 * MIN),
        subject: "SUBJECT-NOROW",
      });
      const inOther = await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: at(-2 * HOUR_MS),
        subject: "SUBJECT-OTHER",
      });
      await insertAttachmentHeaders(trx, ctx, withFile, [pdf]);
      await insertAttachmentHeaders(trx, ctxB, inOther, [{ ...pdf, name: "other-org.pdf" }]);

      const off = (await buildDigestMessage(trx, ctx, request)).text;
      expect(off).toContain("SUBJECT-FILE");
      expect(off).not.toContain("📎");

      await setOrgFeature(trx, ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: T });
      const on = (await buildDigestMessage(trx, ctx, request)).text;
      expect(on).toContain("SUBJECT-FILE\n📎 1: faktura.pdf (120 kB)");
      expect(on.match(/📎/g)).toHaveLength(1);
      expect(on).not.toContain("other-org");

      // B has the flag off: its digest has no line, although the flag of A is on.
      const forB = (await buildDigestMessage(trx, ctxB, request)).text;
      expect(forB).toContain("SUBJECT-OTHER");
      expect(forB).not.toContain("📎");
      await setOrgFeature(trx, ctxB, { flag: "attachment_line", enabled: true, actor: "cli", now: T });
      const forBOn = (await buildDigestMessage(trx, ctxB, request)).text;
      expect(forBOn).toContain("📎 1: other-org.pdf (120 kB)");
      expect(forBOn).not.toContain("faktura");
    });
  });
});

describe("digest why lines (F110 stage 16)", () => {
  const request = {
    kind: "on_demand" as const,
    periodStart: at(-3 * HOUR_MS),
    periodEnd: T,
    slot: null,
    now: T,
    locale: "en" as const,
    role: "owner" as const,
    testMail: NO_TEST_SENDERS,
  };

  test("flag on: percent, rule, delegate tags; flag off and another organization: the text of today", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      await insertDefaultSettings(trx, ctx, a.mailboxId);
      await insertDefaultSettings(trx, ctxB, b.mailboxId);
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-2 * HOUR_MS),
        subject: "SUBJECT-MODEL",
        reason: "A model reason",
        confidence: 0.87,
      });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "needs_reply",
        createdAt: at(-110 * MIN),
        subject: "SUBJECT-VIP",
        reason: "A VIP asks",
        confidence: 0.95,
        fields: { rule: "vip" },
      });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "spam",
        createdAt: at(-100 * MIN),
        subject: "SUBJECT-BLOCKED",
        reasonCode: "blocklist",
        confidence: 1,
        fields: { rule: "blocklist" },
      });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "unsure",
        createdAt: at(-90 * MIN),
        subject: "SUBJECT-UNSURE",
        reason: "Cannot tell",
        confidence: 0.55,
        fields: { model_category: "info" },
      });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "spam",
        createdAt: at(-95 * MIN),
        subject: "SUBJECT-OLDBLOCK",
        reasonCode: "blocklist",
        confidence: 1,
      });
      const anna = await insertDelegate(trx, ctx, {
        name: "Anna Nowak",
        tags: ["finance", "legal", "hr", "it"],
      });
      const delegated = await insertDraftAndSend(trx, ctx, a.mailboxId, {
        delegateId: anna,
        delegateName: "Anna Nowak",
        task: "Prepare the offer",
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: at(-80 * MIN),
        subject: "SUBJECT-DELEGATED",
      });
      // A reverse draft that carries another delegate (created before the original) never shows its tags or its name.
      const bob = await insertDelegate(trx, ctx, { name: "Bob Reverse", tags: ["secret-tag"] });
      await insertAction(trx, ctx, delegated.emailId, {
        type: "create_draft",
        status: "applied",
        payload: { kind: "delegation", delegate_id: bob },
        reversesActionId: delegated.draftId,
        createdAt: at(-85 * MIN),
      });
      await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: at(-2 * HOUR_MS),
        subject: "SUBJECT-OTHER",
        reason: "Other reason",
        confidence: 0.87,
      });

      const off = (await buildDigestMessage(trx, ctx, request)).text;
      expect(off).toContain("SUBJECT-MODEL\n💬 A model reason\n");
      expect(off).not.toContain("85%");
      expect(off).not.toContain("rule:");
      expect(off).not.toContain("skills:");

      await setOrgFeature(trx, ctx, { flag: "why_lines", enabled: true, actor: "cli", now: T });
      const on = (await buildDigestMessage(trx, ctx, request)).text;
      expect(on).toContain("SUBJECT-MODEL\n💬 A model reason · 85%\n");
      expect(on).toContain("SUBJECT-VIP\n💬 A VIP asks · rule: VIP sender\n");
      // A blocked sender: the fixed blocklist text and the rule, no percent.
      expect(on).toMatch(/SUBJECT-BLOCKED\n💬 [^\n]*· rule: blocked sender\n/);
      expect(on).not.toContain("100%");
      // An unsure item keeps its guess percent only.
      expect(on.match(/SUBJECT-UNSURE\n💬 [^\n]*\n/)?.[0]).toContain("55%");
      expect(on.match(/SUBJECT-UNSURE\n💬 [^\n]*\n/)?.[0]).not.toContain("·");
      // The tags sit next to the delegate name, before the send state; at most 3.
      expect(on).toContain(
        "will draft a delegation to Anna Nowak (skills: finance, legal, hr); waits for your approval"
      );
      expect(on).not.toContain(", it)");
      // The same delegation with the flag off: the line of today.
      expect(off).toContain("will draft a delegation to Anna Nowak; waits for your approval");
      // An old blocklist row has no rule key and confidence 1: no percent.
      expect(on).toMatch(/SUBJECT-OLDBLOCK\n💬 The sender is on your blocklist\.\n/);
      expect(on).not.toContain("100%");

      // The flag is per organization.
      const forB = (await buildDigestMessage(trx, ctxB, request)).text;
      expect(on).not.toContain("secret-tag");
      expect(on).not.toContain("Bob Reverse");
      expect(forB).toContain("SUBJECT-OTHER\n💬 Other reason\n");
      expect(forB).not.toContain("%");
    });
  });
});

describe("listDelegateTags (F110 stage 16)", () => {
  test("returns the tags of the own organization only", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      const own = await insertDelegate(trx, ctxA, { tags: ["finance", "legal"] });
      const other = await insertDelegate(trx, ctxB, { tags: ["secret-b"] });
      expect(await listDelegateTags(trx, ctxA, [own, other])).toEqual(new Map([[own, ["finance", "legal"]]]));
      expect(await listDelegateTags(trx, ctxA, [])).toEqual(new Map());
    });
  });
});
