import { describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listRecentSends, markApplying, releaseAction } from "../../src/modules/actions";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDraftAndSend, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

const HOUR = 3_600_000;
const NOW = new Date("2026-11-20T10:00:00Z");
const SINCE = new Date(NOW.getTime() - 24 * HOUR);
const ago = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR);

async function setup(trx: Transaction<DB>) {
  const org = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: org.orgId };
  return { ...org, ctx };
}

// One send of the mailbox in the given state; `startedAt` is the stamp of its SMTP try.
async function sendOf(
  trx: Transaction<DB>,
  s: { ctx: TenantContext; userId: string; mailboxId: string },
  opts: {
    status: string;
    reason?: string;
    startedAt?: Date | null;
    to?: string;
    lockedAt?: Date;
  }
): Promise<string> {
  const { sendId } = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    sendStatus: opts.status,
    to: opts.to,
    approved: opts.status === "awaiting_approval" ? undefined : { userId: s.userId, at: ago(30) },
    lockedAt: opts.lockedAt,
    createdAt: ago(30),
  });
  await trx
    .updateTable("actions")
    .set({ status_reason: opts.reason ?? null, send_started_at: opts.startedAt ?? null })
    .where("id", "=", sendId)
    .where("org_id", "=", s.ctx.orgId)
    .execute();
  return sendId;
}

async function startedAt(trx: Transaction<DB>, id: string): Promise<Date | null> {
  const row = await trx.selectFrom("actions").select("send_started_at").where("id", "=", id).executeTakeFirstOrThrow();
  return row.send_started_at;
}

describe("send_started_at: markApplying", () => {
  test("(2) a send gets the given time; a draft call leaves the column null", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const lockedAt = ago(1);
      const sendId = await sendOf(trx, s, { status: "approved", lockedAt });
      expect(await markApplying(trx, s.ctx, sendId, lockedAt, { sendStartedAt: NOW })).toBe(true);
      expect(await startedAt(trx, sendId)).toEqual(NOW);

      const { emailId } = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { createdAt: ago(30) });
      const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready", lockedAt });
      expect(await markApplying(trx, s.ctx, draftId, lockedAt)).toBe(true);
      expect(await startedAt(trx, draftId)).toBeNull();
    });
  });

  test("(3) a released and marked-again send gets the time of the second try", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const lockedAt = ago(3);
      const sendId = await sendOf(trx, s, { status: "approved", lockedAt });
      expect(await markApplying(trx, s.ctx, sendId, lockedAt, { sendStartedAt: ago(2) })).toBe(true);
      expect(await startedAt(trx, sendId)).toEqual(ago(2));

      expect(
        await releaseAction(trx, s.ctx, sendId, lockedAt, {
          toStatus: "approved",
          nextAttemptAt: null,
          countAttempt: false,
          now: ago(2),
        })
      ).toBe(true);
      const second = ago(1);
      await trx
        .updateTable("actions")
        .set({ locked_at: second })
        .where("id", "=", sendId)
        .where("org_id", "=", s.ctx.orgId)
        .execute();
      expect(await markApplying(trx, s.ctx, sendId, second, { sendStartedAt: NOW })).toBe(true);
      expect(await startedAt(trx, sendId)).toEqual(NOW);
    });
  });
});

describe("send_started_at: listRecentSends", () => {
  test("(4) returns the sends that may have reached people, in time order", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await sendOf(trx, s, { status: "rejected", startedAt: ago(7) });
      await sendOf(trx, s, { status: "expired", startedAt: ago(6) });
      await sendOf(trx, s, { status: "approved", startedAt: ago(5) });
      await sendOf(trx, s, { status: "failed", reason: "smtp_rejected", startedAt: ago(4) });
      await sendOf(trx, s, { status: "failed", reason: "outcome_unknown", startedAt: ago(3) });
      await sendOf(trx, s, { status: "applied", startedAt: ago(2) });
      await sendOf(trx, s, { status: "applying", startedAt: ago(1) });

      const recent = await listRecentSends(trx, s.ctx, s.mailboxId, SINCE);
      expect(recent.map((r) => r.startedAt)).toEqual([ago(3), ago(2), ago(1)]);
    });
  });

  test("(5) a send at exactly `since` is out; one millisecond later is in", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await sendOf(trx, s, { status: "applied", startedAt: SINCE });
      const inside = new Date(SINCE.getTime() + 1);
      await sendOf(trx, s, { status: "applied", startedAt: inside });
      const recent = await listRecentSends(trx, s.ctx, s.mailboxId, SINCE);
      expect(recent.map((r) => r.startedAt)).toEqual([inside]);
    });
  });

  test("(6) a counted send of another mailbox of the organization is not returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const otherMailboxId = crypto.randomUUID();
      await insertMailbox(trx, s.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await sendOf(trx, s, { status: "applied", startedAt: ago(1) });
      await sendOf(trx, { ...s, mailboxId: otherMailboxId }, { status: "applied", startedAt: ago(2) });

      const recent = await listRecentSends(trx, s.ctx, s.mailboxId, SINCE);
      expect(recent.map((r) => r.startedAt)).toEqual([ago(1)]);
    });
  });

  test("(7) the context of another organization sees nothing", async () => {
    await withRollback(db, async (trx) => {
      const first = await setup(trx);
      const second = await setup(trx);
      await sendOf(trx, first, { status: "applied", startedAt: ago(1) });
      expect(await listRecentSends(trx, first.ctx, first.mailboxId, SINCE)).toHaveLength(1);
      expect(await listRecentSends(trx, second.ctx, first.mailboxId, SINCE)).toEqual([]);
    });
  });

  test("(8) `to` keeps the strings of the payload; a cleared payload gives []", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mixed = await sendOf(trx, s, { status: "applied", startedAt: ago(2) });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ to: ["A@x.test", 5, "b@x.test"] }) })
        .where("id", "=", mixed)
        .where("org_id", "=", s.ctx.orgId)
        .execute();
      const cleared = await sendOf(trx, s, { status: "applied", startedAt: ago(1) });
      await trx
        .updateTable("actions")
        .set({ payload: "{}" })
        .where("id", "=", cleared)
        .where("org_id", "=", s.ctx.orgId)
        .execute();

      const recent = await listRecentSends(trx, s.ctx, s.mailboxId, SINCE);
      expect(recent.map((r) => r.to)).toEqual([["A@x.test", "b@x.test"], []]);
    });
  });
});
