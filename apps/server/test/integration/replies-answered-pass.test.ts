import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";
import MailComposer from "nodemailer/lib/mail-composer";

import { getSend } from "../../src/modules/actions";
import { approvalViewFor } from "../../src/modules/channels/notices/approval";
import type { MailProvider } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";
import { captureLogs, type CapturedLogs } from "../log-capture";

import {
  actionRow,
  draftCopies,
  deleteCopy,
  editCopy,
  MINUTE,
  NOW,
  reverseOf,
  runSend,
  seedPair,
  tap,
  type CopyBox,
} from "./copy-hash-fixtures";
import { testDb, withRollback } from "./helpers";
import { addThreadMail, appendUserReply, messageIdOf, sentSyncFlagOnly, sentSyncOn } from "./reply-answered-fixtures";

// F115 stage 09, step 1: the pass before a reply send. GreenMail holds the Drafts, Sent and INBOX folders; the test acts like the mail
// client of the user (a reply in Sent, a flag on the original, an edit of the draft). Every close here sends nothing.
const db = testDb();
const boxes: CopyBox[] = [];
let logs: CapturedLogs | null = null;

afterEach(async () => {
  logs?.stop();
  logs = null;
  for (const box of boxes) await box.close();
  boxes.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const LATE = new Date(NOW.getTime() - 30 * MINUTE);

// The `result` codes of the lines `reply_send_checked` that the pass writes (the copy check writes the others).
const passResults = (captured: CapturedLogs): unknown[] =>
  captured.lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter(
      (line) =>
        line.event === "reply_send_checked" &&
        ["answered", "not_answered", "newer_mail", "original_moved"].includes(String(line.result))
    )
    .map((line) => line.result);

// Every IMAP call of the committer's connection before the SMTP call: `method:first argument`.
function traceCalls(box: CopyBox): string[] {
  const calls: string[] = [];
  box.wrap.provider = (provider) =>
    new Proxy(provider, {
      get(target, name, receiver) {
        const value: unknown = Reflect.get(target, name, receiver);
        if (typeof value !== "function" || typeof name !== "string") return value;
        return (...args: unknown[]) => {
          if (box.sender.sent.length === 0) calls.push(`${name}:${String(args[0])}`);
          return (value as (...rest: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return calls;
}

// The original mail on the server (INBOX) with its flags, and the row of the test pointing at it, so that the flag read finds it.
async function putOriginal(
  trx: Transaction<DB>,
  box: CopyBox,
  emailId: string,
  flags: string[],
  messageId?: string
): Promise<number> {
  const raw = await new MailComposer({
    from: "boss@x.test",
    to: box.address,
    subject: "Offer",
    text: "Please prepare the offer",
    messageId: messageId ?? (await messageIdOf(trx, emailId)),
    date: new Date(NOW.getTime() - 2 * 60 * MINUTE),
  })
    .compile()
    .build();
  const appended = await box.mailClient.appendMessage("INBOX", raw, flags, new Date(NOW.getTime() - 2 * 60 * MINUTE));
  if (appended.uid === null) throw new Error("the server gave no UID");
  await trx.updateTable("emails").set({ uid: appended.uid, folder: "INBOX" }).where("id", "=", emailId).execute();
  return appended.uid;
}

describe("the pass before a reply send: answered", () => {
  test("1. the user's reply is in Sent (sent_sync on) → answered, zero SMTP calls, the copy is deleted, the owner is told", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, box.ctx, box.mailboxId);
      await appendUserReply(box, await messageIdOf(trx, p.emailId), LATE);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "answered", locked_at: null });
      // `notify: true`: the result detector writes the notice.
      expect(send.result_notified_at).toBeNull();
      expect(box.sender.sent).toHaveLength(0);
      expect(box.decided).toContainEqual({ sendId: p.sendId, decision: "expired" });
      expect(passResults(logs)).toEqual(["answered"]);
      // The copy is unchanged, so the reverse row of the draft deletes it.
      await box.committer.run();
      expect(await draftCopies(box)).toHaveLength(0);
      expect(await reverseOf(trx, p.draftId)).toMatchObject({ status: "applied", provider_result: { found: true } });
    });
  });

  test("2. the same, and the copy is gone too → sent_by_user", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, box.ctx, box.mailboxId);
      await appendUserReply(box, await messageIdOf(trx, p.emailId), LATE);
      await deleteCopy(box, p.draftId);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "sent_by_user", locked_at: null });
      expect(send.result_notified_at).toBeNull();
      expect(box.sender.sent).toHaveLength(0);
    });
  });

  test("2b. answered and the user edited the copy → draft_changed, the copy stays; answered and no baseline → answered, the copy stays", async () => {
    await withRollback(db, async (trx) => {
      const changed = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, changed.box.ctx, changed.box.mailboxId);
      await appendUserReply(changed.box, await messageIdOf(trx, changed.p.emailId), LATE);
      await editCopy(changed.box, changed.p.draftId, { text: (text) => `${text}\n\nMy own line` });
      const send = await runSend(trx, changed.box, changed.p.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "draft_changed" });
      expect(changed.box.sender.sent).toHaveLength(0);
      await changed.box.committer.run();
      expect(await draftCopies(changed.box)).toHaveLength(1);

      const bare = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, bare.box.ctx, bare.box.mailboxId);
      await appendUserReply(bare.box, await messageIdOf(trx, bare.p.emailId), LATE);
      const row = await actionRow(trx, bare.p.draftId);
      const rest = Object.fromEntries(
        Object.entries(row.provider_result as Record<string, unknown>).filter(([key]) => key !== "copy_hash")
      );
      await trx
        .updateTable("actions")
        .set({ provider_result: JSON.stringify(rest) })
        .where("id", "=", bare.p.draftId)
        .execute();
      const bareSend = await runSend(trx, bare.box, bare.p.sendId);
      expect(bareSend).toMatchObject({ status: "expired", status_reason: "answered" });
      expect(bare.box.sender.sent).toHaveLength(0);
      await bare.box.committer.run();
      // The copy was never compared: it stays (the text may be the user's).
      expect(await draftCopies(bare.box)).toHaveLength(1);
    });
  });

  test("3. sent_sync off, the original has \\Answered on the server → answered; the flag is stored", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await putOriginal(trx, box, p.emailId, ["\\Answered"]);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "answered" });
      expect(box.sender.sent).toHaveLength(0);
      const flags = await trx
        .selectFrom("email_flags")
        .select(["answered", "first_answered_at"])
        .where("email_id", "=", p.emailId)
        .executeTakeFirstOrThrow();
      expect(flags.answered).toBe(true);
      expect(flags.first_answered_at?.getTime()).toBe(NOW.getTime());
      expect(passResults(logs)).toEqual(["answered"]);
    });
  });

  test("3b. the UID on the server names another mail (a UIDVALIDITY change): its \\Answered flag is not the flag of this mail", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await putOriginal(trx, box, p.emailId, ["\\Answered"], "<some-other-mail@x.test>");

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "applied" });
      expect(passResults(logs)).toEqual(["not_answered"]);
      expect(
        await trx.selectFrom("email_flags").select("answered").where("email_id", "=", p.emailId).execute()
      ).toEqual([]);
    });
  });

  test("4. sent_sync off and no flag → the reply is sent; the approval view says that the Sent mail is not visible", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await putOriginal(trx, box, p.emailId, ["\\Seen"]);
      const waiting = await getSend(trx, box.ctx, p.sendId);
      if (waiting === undefined) throw new Error("no send");
      expect((await approvalViewFor(trx, box.ctx, waiting)).view.sentVisible).toBe(false);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "applied" });
      expect(box.sender.sent).toHaveLength(1);
      expect(passResults(logs)).toEqual(["not_answered"]);

      // With the Sent mail read, the card has no such note.
      const seen = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, seen.box.ctx, seen.box.mailboxId);
      const other = await getSend(trx, seen.box.ctx, seen.p.sendId);
      if (other === undefined) throw new Error("no send");
      expect((await approvalViewFor(trx, seen.box.ctx, other)).view.sentVisible).toBeUndefined();

      // The org flag alone is not enough: the switch of the mailbox must be on too.
      const flagOnly = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncFlagOnly(trx, flagOnly.box.ctx);
      const third = await getSend(trx, flagOnly.box.ctx, flagOnly.p.sendId);
      if (third === undefined) throw new Error("no send");
      expect((await approvalViewFor(trx, flagOnly.box.ctx, third)).view.sentVisible).toBe(false);
    });
  });

  test("4b. sent_sync on: a reply to another mail does not count; the reply is sent", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, box.ctx, box.mailboxId);
      await appendUserReply(box, "<another-mail@x.test>", LATE);

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "applied" });
      expect(box.sender.sent).toHaveLength(1);
    });
  });
});

describe("the pass before a reply send: the DB facts", () => {
  test("5. a newer mail in the thread after the tap → newer_mail, zero SMTP calls, no IMAP call", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      const calls = traceCalls(box);
      await tap(trx, box, p.sendId);
      await addThreadMail(trx, box.ctx, p.emailId, { receivedAt: new Date(NOW.getTime() - MINUTE) });

      await box.committer.run();

      const send = await actionRow(trx, p.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "newer_mail", locked_at: null });
      expect(send.result_notified_at).toBeNull();
      expect(box.sender.sent).toHaveLength(0);
      expect(calls.filter((call) => call.startsWith("fetchFlagsIn") || call.startsWith("folderStatus"))).toEqual([]);
      expect(passResults(logs)).toEqual(["newer_mail"]);
    });
  });

  test("5b. a newer automatic mail (Auto-Submitted: auto-replied) does not stop the reply", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await addThreadMail(trx, box.ctx, p.emailId, {
        receivedAt: new Date(NOW.getTime() - MINUTE),
        autoSubmitted: "auto-replied",
      });
      const send = await runSend(trx, box, p.sendId);
      expect(send).toMatchObject({ status: "applied" });
      expect(box.sender.sent).toHaveLength(1);
    });
  });

  test("5c. the original left its folder (the mail was moved) → original_moved, zero SMTP calls", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await trx.updateTable("emails").set({ folder: "Archive" }).where("id", "=", p.emailId).execute();

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "expired", status_reason: "original_moved", locked_at: null });
      expect(box.sender.sent).toHaveLength(0);
      expect(passResults(logs)).toEqual(["original_moved"]);
      await box.committer.run();
      expect(await draftCopies(box)).toHaveLength(0);
    });
  });

  test("5d. a newer mail wins over an answer; the copy is removed when it is unchanged", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, box.ctx, box.mailboxId);
      await appendUserReply(box, await messageIdOf(trx, p.emailId), LATE);
      await tap(trx, box, p.sendId);
      await addThreadMail(trx, box.ctx, p.emailId, { receivedAt: new Date(NOW.getTime() - MINUTE) });

      await box.committer.run();

      expect(await actionRow(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "newer_mail" });
      expect(box.sender.sent).toHaveLength(0);
    });
  });
});

describe("the pass before a reply send: kinds and errors", () => {
  test("6. a delegation send has no Sent pass and no flag read: the IMAP trace before the SMTP call names neither", async () => {
    await withRollback(db, async (trx) => {
      const delegation = await seedPair(trx, boxes, { kind: "delegation", flag: false });
      await sentSyncOn(trx, delegation.box.ctx, delegation.box.mailboxId);
      const delegationCalls = traceCalls(delegation.box);
      const sent = await runSend(trx, delegation.box, delegation.p.sendId);
      expect(sent).toMatchObject({ status: "applied" });
      expect(delegationCalls.filter((call) => /^(folderStatus|fetchAbove|fetchFlagsIn):/.test(call))).toEqual([]);

      // The same setup with a reply does read both.
      const reply = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, reply.box.ctx, reply.box.mailboxId);
      const replyCalls = traceCalls(reply.box);
      expect((await runSend(trx, reply.box, reply.p.sendId)).status).toBe("applied");
      expect(replyCalls).toContain("folderStatus:Sent");
      expect(replyCalls.some((call) => call.startsWith("fetchFlagsIn:"))).toBe(true);
    });
  });

  test("7. a soft IMAP error in the flag read → the send goes back to approved for 5 minutes with no count, nothing is sent; the next try sends", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      box.wrap.provider = (provider: MailProvider) =>
        new Proxy(provider, {
          get(target, name, receiver) {
            if (name === "fetchFlagsIn") return () => Promise.reject(new SoftError("timeout"));
            return Reflect.get(target, name, receiver);
          },
        });

      const first = await runSend(trx, box, p.sendId);

      expect(first).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
      expect(first.next_attempt_at?.getTime()).toBe(NOW.getTime() + 5 * MINUTE);
      expect(box.sender.sent).toHaveLength(0);

      box.wrap.provider = (provider) => provider;
      box.clock.now = new Date(NOW.getTime() + 6 * MINUTE);
      await box.committer.run();
      expect(await actionRow(trx, p.sendId)).toMatchObject({ status: "applied" });
      expect(box.sender.sent).toHaveLength(1);
    });
  });

  test("7b. the Sent pass runs out of its time budget → the send waits (a partial read could miss the answer); nothing is sent", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await sentSyncOn(trx, box.ctx, box.mailboxId);
      await appendUserReply(box, await messageIdOf(trx, p.emailId), LATE);
      box.tune.sentBudgetMs = 20;
      box.wrap.provider = (provider: MailProvider) =>
        new Proxy(provider, {
          get(target, name, receiver) {
            if (name === "folderStatus") {
              return async (folder: string) => {
                await new Promise((resolve) => setTimeout(resolve, 400));
                return target.folderStatus(folder);
              };
            }
            return Reflect.get(target, name, receiver);
          },
        });

      const first = await runSend(trx, box, p.sendId);

      expect(first).toMatchObject({ status: "approved", attempts: 0, locked_at: null });
      expect(first.next_attempt_at?.getTime()).toBe(NOW.getTime() + 5 * MINUTE);
      expect(box.sender.sent).toHaveLength(0);
    });
  });

  test("7c. the original is no longer on the server (the UID is gone) → not answered by the flag; the reply is sent", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });

      const send = await runSend(trx, box, p.sendId);

      expect(send).toMatchObject({ status: "applied" });
      expect(passResults(logs)).toEqual(["not_answered"]);
    });
  });
});
