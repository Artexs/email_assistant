import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { isOwnActionId, sentOriginOf } from "../../src/modules/actions";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { loopHooks } from "../../src/modules/loops";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { syncSentHeaders } from "../../src/modules/mail/sent-sync";
import { configureFeatures } from "../../src/modules/tenancy";
import { captureLogs, logProblems } from "../log-capture";

import {
  NOW,
  at,
  MARKERS,
  Setup,
  setup,
  followUp,
  tap,
  committerOf,
  loopOf,
  prepare,
} from "./actions-follow-up-helpers";
import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { depsOf as sentDepsOf, newOrg, put } from "./mail-sent-fixtures";

// The follow-up kind goes through the committer. A follow-up hangs on a loop (`loop_id`), not on a mail.
// Every test runs in a transaction that is rolled back: a committed loop row would break the Down guard of the migration test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("T9 the Sent copy of a follow-up is the system's own mail", () => {
  test("sentOriginOf: a started or applied loop send, and its draft, are system; a waiting one is a user draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const done = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });
      const waiting = await followUp(trx, s, { draftStatus: "applied", sendStatus: "awaiting_approval" });
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, done.draftId)).toBe("system");
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, done.sendId)).toBe("system");
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, waiting.draftId)).toBe("draft");
      // The header of a Sent copy names the draft: it is an own action of this mailbox only.
      expect(await isOwnActionId(trx, s.ctx, s.mailboxId, done.draftId)).toBe(true);
      // Another mailbox, another organization: null.
      const other = await createOrgWithMailbox(trx);
      expect(await sentOriginOf(trx, { orgId: other.orgId }, other.mailboxId, done.draftId)).toBeNull();
      expect(await sentOriginOf(trx, s.ctx, other.mailboxId, done.draftId)).toBeNull();
      expect(await isOwnActionId(trx, s.ctx, other.mailboxId, done.draftId)).toBe(false);
      expect(await isOwnActionId(trx, { orgId: other.orgId }, s.mailboxId, done.draftId)).toBe(false);
    });
  });

  test("the Sent pass reads the copy: a system row with the action id, headers only, no analysis row", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const s: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const done = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });
      put(org, 1, new Date(NOW.getTime() - HOUR_MS), { headers: { "X-EA-Action-Id": done.draftId } });
      const result = await syncSentHeaders(sentDepsOf(trx, org), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", stored: 1, system: 1 });
      const rows = await trx
        .selectFrom("sent_emails")
        .select(["origin", "content", "action_id", "body_text"])
        .where("org_id", "=", org.ctx.orgId)
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      // The loop's own sent mail is a seeded row too; the pass added the one with the action id.
      const copy = rows.find((entry) => entry.action_id === done.draftId);
      expect(copy).toMatchObject({ origin: "system", content: "headers_only", body_text: null });
      const analyses = await trx
        .selectFrom("sent_analyses")
        .select("sent_email_id")
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(analyses).toEqual([]);
    });
  });
});

describe("onFollowUpSent", () => {
  test("a third count never raises the CHECK: the mail has gone out, the commit must hold", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { loop: { follow_ups_sent: 2 } });
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: p.loopId,
        sendId: p.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(2);
    });
  });

  test("a short wait setting never makes the next follow-up due before 3 working days", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 1 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      expect((await getMailboxSettings(trx, s.ctx, s.mailboxId))?.loop_wait_days).toBe(1);
      const p = await followUp(trx, s);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: p.loopId,
        sendId: p.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, p.loopId)).due_at.toISOString()).toBe("2026-11-25T16:00:00.000Z");
      // A long setting wins: 5 working days after Friday 20 Nov is Friday 27 Nov.
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 5 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const q = await followUp(trx, s);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: q.loopId,
        sendId: q.sendId,
        messageId: "<g@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, q.loopId)).due_at.toISOString()).toBe("2026-11-27T16:00:00.000Z");
    });
  });

  test("a closed loop gets the counters and keeps its due date; another organization's loop is not touched", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await createOrgWithMailbox(trx);
      const closed = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-5) } });
      const foreign = await followUp(
        trx,
        { ...s, ctx: { orgId: other.orgId }, mailboxId: other.mailboxId, userId: other.userId },
        {}
      );
      const before = await loopOf(trx, closed.loopId);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: closed.loopId,
        sendId: closed.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      const after = await loopOf(trx, closed.loopId);
      expect(after.follow_ups_sent).toBe(1);
      expect(after.due_at.getTime()).toBe(before.due_at.getTime());
      expect(after.message_id).toBe(before.message_id);
      // A hook call with the context of the wrong organization finds no loop.
      const foreignBefore = await loopOf(trx, foreign.loopId);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: foreign.loopId,
        sendId: foreign.sendId,
        messageId: "<g@x.test>",
        at: NOW,
      });
      expect(await loopOf(trx, foreign.loopId)).toEqual(foreignBefore);
      expect(await loopHooks().isOpen(trx, s.ctx, foreign.loopId)).toBe(false);
      expect(await loopHooks().anchorOf(trx, s.ctx, foreign.loopId)).toBeUndefined();
    });
  });

  test("anchorOf gives the thread, the copied recipients and the stored text of the opening mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s);
      const anchor = await loopHooks().anchorOf(trx, s.ctx, p.loopId);
      expect(anchor).toMatchObject({
        mailboxId: s.mailboxId,
        messageId: "<own-1@x.test>",
        referencesIds: ["<root@x.test>"],
        to: [MARKERS.anna],
        cc: [MARKERS.jan],
        language: "en",
        quote: MARKERS.quote,
      });
      // After retention the text is gone: no quote.
      await trx.updateTable("sent_emails").set({ content: "gone", body_text: null }).execute();
      expect((await loopHooks().anchorOf(trx, s.ctx, p.loopId))?.quote).toBeNull();
    });
  });
});

describe("logs", () => {
  test("a follow-up run writes no address, subject or quote into a log line", async () => {
    const capture = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const s = await prepare(trx);
        const sent = await followUp(trx, s);
        const closed = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-5) } });
        const clock = { now: NOW };
        const committer = committerOf(trx, s, clock);
        await committer.run();
        await tap(trx, s, sent.sendId);
        await tap(trx, s, closed.sendId);
        clock.now = at(5);
        await committer.run();
        expect(s.sender.sent).toHaveLength(1);
      });
      const lines = capture.lines.filter((line) => line.includes('"module":"actions"'));
      expect(lines.length).toBeGreaterThan(0);
      expect(
        logProblems(capture.lines, [MARKERS.anna, MARKERS.jan, MARKERS.ewa, MARKERS.subject, MARKERS.quote])
      ).toEqual([]);
    } finally {
      capture.stop();
    }
  });
});
