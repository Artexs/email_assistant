import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { listSendResultsToNotify } from "../../src/modules/actions";
import { setMailboxStatus } from "../../src/modules/mail/repo";
import { captureLogs, type CapturedLogs } from "../log-capture";

import { testDb, withRollback } from "./helpers";
import { NOW, send, sweepOf, run } from "./replies-sweep-helpers";
import { addThreadMail, markAnswered, sweepOrg, sweepReply, T0 } from "./reply-answered-fixtures";

// The sweep closes open reply sends whose reason to exist ended. It reads the database only.
const db = testDb();
let logs: CapturedLogs | null = null;

afterEach(() => {
  logs?.stop();
  logs = null;
});

afterAll(async () => {
  await db.destroy();
});

describe("the sweep: races with a tap and with a claim (review N1, T2)", () => {
  test("N1. a tap between the list and the close: the close locks the row as approved, so the user gets a result notice", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o);
      await markAnswered(trx, o, pair.emailId);
      // `now()` runs once per close, after the list and before the close transaction: the tap lands there.
      const now = () => {
        void trx
          .updateTable("actions")
          .set({ status: "approved", approved_at: NOW, approved_by: o.userId, approved_via: "web" })
          .where("id", "=", pair.sendId)
          .execute();
        return NOW;
      };

      const result = await sweepOf(trx, [], { now }).run({ mailboxIds: [o.mailboxId] });

      expect(result.closed.answered).toBe(1);
      expect(await send(trx, pair.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: null,
      });
      const toTell = await listSendResultsToNotify(trx, o.ctx, { limit: 10, now: NOW, pendingCopyMaxAgeMs: 600_000 });
      expect(toTell.map((row) => row.id)).toEqual([pair.sendId]);
    });
  });

  test("T2. a committer claim between the list and the close: the close answers busy, nothing is closed, no notice", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o, { status: "approved" });
      await markAnswered(trx, o, pair.emailId);
      const now = () => {
        void trx.updateTable("actions").set({ locked_at: NOW }).where("id", "=", pair.sendId).execute();
        return NOW;
      };

      const result = await sweepOf(trx, [], { now }).run({ mailboxIds: [o.mailboxId] });

      expect(result).toMatchObject({ checked: 1, skipped: 1, mailboxErrors: 0, closed: { answered: 0 } });
      expect(await send(trx, pair.sendId)).toMatchObject({ status: "approved", status_reason: null });
      expect(logs.lines.some((line) => line.includes("reply_closed"))).toBe(false);
    });
  });
});

describe("the sweep and the pass: moves, junk, spam (review N6, N7)", () => {
  test("N6. a move that the assistant made (moved_at set) does not close the reply; a move of the user does", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const byAssistant = await sweepReply(trx, o);
      const byUser = await sweepReply(trx, o);
      await trx
        .updateTable("emails")
        .set({ folder: "Archive", moved_at: T0 })
        .where("id", "=", byAssistant.emailId)
        .execute();
      await trx.updateTable("emails").set({ folder: "Archive" }).where("id", "=", byUser.emailId).execute();

      const result = await run(trx, o);

      expect(result.closed.original_moved).toBe(1);
      expect((await send(trx, byAssistant.sendId)).status).toBe("awaiting_approval");
      expect(await send(trx, byUser.sendId)).toMatchObject({ status: "expired", status_reason: "original_moved" });
    });
  });

  test("N7. a newer mail in the junk folder, in the trash folder, or in the spam category does not close the reply", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: o.ctx.orgId, mailbox_id: o.mailboxId, key: "junk", path: "Junk", role: "junk" })
        .execute();
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", trash: "Trash" }) })
        .where("id", "=", o.mailboxId)
        .execute();
      const junk = await sweepReply(trx, o);
      const junkSource = await sweepReply(trx, o);
      const trash = await sweepReply(trx, o);
      const spam = await sweepReply(trx, o);
      const real = await sweepReply(trx, o);
      const later = new Date(T0.getTime() + HOUR_MS);
      const inJunk = await addThreadMail(trx, o.ctx, junk.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ folder: "Junk" }).where("id", "=", inJunk).execute();
      const fromJunk = await addThreadMail(trx, o.ctx, junkSource.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ source_folder: "Junk" }).where("id", "=", fromJunk).execute();
      const inTrash = await addThreadMail(trx, o.ctx, trash.emailId, { receivedAt: later });
      await trx.updateTable("emails").set({ folder: "Trash" }).where("id", "=", inTrash).execute();
      const spamMail = await addThreadMail(trx, o.ctx, spam.emailId, { receivedAt: later });
      const triage = (emailId: string, category: string, at: Date) =>
        trx
          .insertInto("triage_results")
          .values({
            org_id: o.ctx.orgId,
            email_id: emailId,
            category,
            confidence: 0.9,
            reason_code: "direct_request",
            fields: "{}",
            suspicious_reasons: [],
            created_at: at,
          })
          .execute();
      await triage(spamMail, "spam", later);
      await addThreadMail(trx, o.ctx, real.emailId, { receivedAt: later });

      const result = await run(trx, o);

      expect(result.closed.newer_mail).toBe(1);
      for (const kept of [junk, junkSource, trash, spam])
        expect((await send(trx, kept.sendId)).status).toBe("awaiting_approval");
      expect(await send(trx, real.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });

      // The newest result decides: a mail that was spam and is now `needs_reply` counts.
      await triage(spamMail, "needs_reply", new Date(later.getTime() + HOUR_MS));
      await run(trx, o);
      expect(await send(trx, spam.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
    });
  });
});

describe("the sweep: a paused mailbox, and a Sent row whose header is not read yet (stage 09 re-review G1, N-a)", () => {
  test("G1. a mailbox that is not active (paused) is not swept: its answered send stays open; after a resume it closes", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const pair = await sweepReply(trx, o);
      await markAnswered(trx, o, pair.emailId);
      await setMailboxStatus(trx, o.ctx, o.mailboxId, "paused", T0);

      const paused = await run(trx, o);

      expect(paused).toMatchObject({ mailboxes: 0, checked: 0 });
      expect((await send(trx, pair.sendId)).status).toBe("awaiting_approval");

      await setMailboxStatus(trx, o.ctx, o.mailboxId, "active", T0);
      const resumed = await run(trx, o);

      expect(resumed.closed.answered).toBe(1);
      expect(await send(trx, pair.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test("N-a. a user Sent row with content pending and no Auto-Submitted does not close the reply; once read (stored, or headers known) it does", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const unread = await sweepReply(trx, o, { messageId: "<unread-one@x.test>" });
      const sentRow = async (parent: string, content: "pending" | "stored", autoSubmitted: string | null) =>
        trx
          .insertInto("sent_emails")
          .values({
            org_id: o.ctx.orgId,
            mailbox_id: o.mailboxId,
            dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
            path: "Sent",
            uidvalidity: "7",
            uid: String(Math.floor(Math.random() * 1_000_000)),
            message_id: `<${randomUUID()}@x.test>`,
            parent_message_id: parent,
            thread_key: parent,
            to_addresses: ["boss@x.test"],
            origin: "user",
            content,
            auto_submitted: autoSubmitted,
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      const row = await sentRow("<unread-one@x.test>", "pending", null);

      const first = await run(trx, o);

      expect(first.closed.answered).toBe(0);
      expect((await send(trx, unread.sendId)).status).toBe("awaiting_approval");

      // The text step read the mail: no automatic header, so it is an answer.
      await trx.updateTable("sent_emails").set({ content: "stored" }).where("id", "=", row.id).execute();
      const second = await run(trx, o);

      expect(second.closed.answered).toBe(1);
      expect(await send(trx, unread.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });

  test("N-a. a pending row with a stored `no` counts as an answer", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const withNo = await sweepReply(trx, o, { messageId: "<with-no@x.test>" });
      const insert = (parent: string, autoSubmitted: string) =>
        trx
          .insertInto("sent_emails")
          .values({
            org_id: o.ctx.orgId,
            mailbox_id: o.mailboxId,
            dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
            path: "Sent",
            uidvalidity: "7",
            uid: String(Math.floor(Math.random() * 1_000_000)),
            message_id: `<${randomUUID()}@x.test>`,
            parent_message_id: parent,
            thread_key: parent,
            to_addresses: ["boss@x.test"],
            origin: "user",
            content: "pending",
            auto_submitted: autoSubmitted,
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .execute();
      await insert("<with-no@x.test>", "no");

      await run(trx, o);

      expect(await send(trx, withNo.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
    });
  });
});
