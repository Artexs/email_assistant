import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { listSendResultsToNotify } from "../../src/modules/actions";
import { newerMailInThread } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { captureLogs, type CapturedLogs } from "../log-capture";

import { insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { NOW, send, run } from "./replies-sweep-helpers";
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

describe("the sweep: answered", () => {
  test("1. email_flags.answered closes a waiting reply with no result notice, and a held approved reply with one", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const o = await sweepOrg(trx);
      const waiting = await sweepReply(trx, o);
      const held = await sweepReply(trx, o, { status: "approved" });
      await markAnswered(trx, o, waiting.emailId);
      await markAnswered(trx, o, held.emailId);
      const decided: { sendId: string; decision: string }[] = [];

      const result = await run(trx, o, decided);

      expect(result).toMatchObject({ checked: 2, skipped: 0, closed: { answered: 2 } });
      expect(await send(trx, waiting.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: NOW,
      });
      expect(await send(trx, held.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: null,
      });
      const toTell = await listSendResultsToNotify(trx, o.ctx, { limit: 10, now: NOW, pendingCopyMaxAgeMs: 600_000 });
      expect(toTell.map((row) => row.id)).toEqual([held.sendId]);
      // The cards of both lose their buttons.
      expect(decided.map((entry) => entry.sendId).sort()).toEqual([held.sendId, waiting.sendId].sort());
      expect(decided.every((entry) => entry.decision === "expired")).toBe(true);
      // One event line per close; ids and codes only.
      const lines = logs.lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((l) => l.event === "reply_closed");
      expect(lines.map((line) => [line.action_id, line.reason]).sort()).toEqual(
        [
          [waiting.sendId, "answered"],
          [held.sendId, "answered"],
        ].sort()
      );
      // The draft of a closed send is closed too: the copy goes through a reverse row.
      expect(
        await trx.selectFrom("actions").select("id").where("reverses_action_id", "=", waiting.draftId).execute()
      ).toHaveLength(1);
    });
  });

  test("1b. a reply of the user in the Sent rows (sent_emails, origin user) closes it; a system row does not", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const answered = await sweepReply(trx, o, { messageId: "<answered-one@x.test>" });
      const system = await sweepReply(trx, o, { messageId: "<system-one@x.test>" });
      const sentRow = (parent: string, origin: "user" | "system", actionId: string | null = null) =>
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
            origin,
            action_id: actionId,
            content: "headers_only",
            sent_at: new Date(T0.getTime() + HOUR_MS),
            internal_date: new Date(T0.getTime() + HOUR_MS),
          })
          .execute();
      await sentRow("<answered-one@x.test>", "user");
      // A row of a send of the system has the id of its action; it is no answer of the user.
      await sentRow("<system-one@x.test>", "system", system.draftId);

      await run(trx, o);

      expect(await send(trx, answered.sendId)).toMatchObject({ status: "expired", status_reason: "answered" });
      expect((await send(trx, system.sendId)).status).toBe("awaiting_approval");
    });
  });
});

describe("the sweep: newer mail, moved mail, suspicious mail", () => {
  test("2. a newer mail in the thread closes it; a newer automatic mail (out-of-office) leaves it open", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const closed = await sweepReply(trx, o);
      const open = await sweepReply(trx, o);
      await addThreadMail(trx, o.ctx, closed.emailId, { receivedAt: new Date(T0.getTime() + HOUR_MS) });
      await addThreadMail(trx, o.ctx, open.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "auto-replied",
      });

      const result = await run(trx, o);

      expect(result.closed.newer_mail).toBe(1);
      expect(await send(trx, closed.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
      expect((await send(trx, open.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("2b. an older mail drafted first and a newer mail of another category after it (stage 07 carry-over): the sweep closes the older draft", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const thread = `<thread-${randomUUID()}@x.test>`;
      const older = await sweepReply(trx, o, { threadKey: thread });
      // A newsletter in the same thread: no open reply, no request, so the drafter let the older draft stand.
      await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "info",
        createdAt: new Date(T0.getTime() + HOUR_MS),
        threadKey: thread,
      });

      await run(trx, o);

      expect(await send(trx, older.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
    });
  });

  test("7. a later triage result with auth_fail closes it as suspicious; a clean later result does not", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const flagged = await sweepReply(trx, o);
      const cleared = await sweepReply(trx, o);
      const result = (emailId: string, at: Date, reasons: string[]) =>
        trx
          .insertInto("triage_results")
          .values({
            org_id: o.ctx.orgId,
            email_id: emailId,
            category: "needs_reply",
            confidence: 0.9,
            reason_code: "direct_request",
            fields: "{}",
            suspicious_reasons: reasons,
            created_at: at,
          })
          .execute();
      await result(flagged.emailId, new Date(T0.getTime() + HOUR_MS), ["auth_fail"]);
      // A flag that a later result removes is gone: the newest result decides.
      await result(cleared.emailId, new Date(T0.getTime() + HOUR_MS), ["auth_fail"]);
      await result(cleared.emailId, new Date(T0.getTime() + 2 * HOUR_MS), []);

      const swept = await run(trx, o);

      expect(swept.closed.suspicious).toBe(1);
      expect(await send(trx, flagged.sendId)).toMatchObject({ status: "expired", status_reason: "suspicious" });
      expect((await send(trx, cleared.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("3. the folder of the original changed (Archive) → original_moved", async () => {
    await withRollback(db, async (trx) => {
      const o = await sweepOrg(trx);
      const moved = await sweepReply(trx, o);
      const stays = await sweepReply(trx, o);
      await trx.updateTable("emails").set({ folder: "Archive" }).where("id", "=", moved.emailId).execute();

      const result = await run(trx, o);

      expect(result.closed.original_moved).toBe(1);
      expect(await send(trx, moved.sendId)).toMatchObject({ status: "expired", status_reason: "original_moved" });
      expect((await send(trx, stays.sendId)).status).toBe("awaiting_approval");
    });
  });
});

describe("newerMailInThread (D7)", () => {
  test("a mail of another mailbox, another thread or another organization does not count; the order is received_at, then id", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const b = await sweepOrg(trx);
      const thread = `<thread-${randomUUID()}@x.test>`;
      const first = await sweepReply(trx, a, { threadKey: thread });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // The same thread key in another mailbox of the same organization: no.
      const sibling = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: sibling,
        address: `sibling-${sibling}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await insertInboxFolder(trx, a.ctx, sibling);
      await insertTestEmail(trx, a.ctx, sibling, {
        thread_key: thread,
        status: "triaged",
        received_at: new Date(T0.getTime() + HOUR_MS),
        uid: 77,
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // The same thread key in another organization, and another thread of the same mailbox: no.
      await sweepReply(trx, b, { threadKey: thread, createdAt: new Date(T0.getTime() + HOUR_MS) });
      await sweepReply(trx, a, { createdAt: new Date(T0.getTime() + HOUR_MS) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An older mail of the thread: not newer.
      await addThreadMail(trx, a.ctx, first.emailId, { receivedAt: new Date(T0.getTime() - HOUR_MS) });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);

      // An automatic mail, with parameters or in capitals: not newer. `no` is not automatic.
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "Auto-Generated; x=1",
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(false);
      await addThreadMail(trx, a.ctx, first.emailId, {
        receivedAt: new Date(T0.getTime() + HOUR_MS),
        autoSubmitted: "no",
      });
      expect(await newerMailInThread(trx, a.ctx, first.emailId)).toBe(true);
      // Another organization reading this mail finds nothing, although a newer mail exists.
      expect(await newerMailInThread(trx, b.ctx, first.emailId)).toBe(false);
    });
  });

  test("the same received_at: the mail with the higher id is newer", async () => {
    await withRollback(db, async (trx) => {
      const a = await sweepOrg(trx);
      const first = await sweepReply(trx, a, { threadKey: `<thread-${randomUUID()}@x.test>` });
      const sibling = await addThreadMail(trx, a.ctx, first.emailId, { receivedAt: T0 });
      const [low, high] = first.emailId < sibling ? [first.emailId, sibling] : [sibling, first.emailId];
      expect(await newerMailInThread(trx, a.ctx, low)).toBe(true);
      expect(await newerMailInThread(trx, a.ctx, high)).toBe(false);
    });
  });
});
