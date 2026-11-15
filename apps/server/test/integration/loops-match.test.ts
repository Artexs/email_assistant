import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { loopHooks, matchReplies } from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { insertDelegate } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair } from "./loops-fixtures";
import {
  ANNA,
  after,
  closedAudit,
  JAN,
  junkFolder,
  loopRow,
  loopsOrg,
  recipientMails,
  reply,
  RUN_AT,
  SUBJECT,
  waiting,
  WAIT_FROM,
} from "./loops-match-fixtures";
import { siblingMailbox, type Org } from "./mail-sent-fixtures";

// The close rules on the database (F116 stage 13, step 2). The reads that two connections race on are in
// `loops-match-concurrent.test.ts`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const run = (trx: Transaction<DB>, org: Org, now: Date = RUN_AT) =>
  matchReplies({ db: trx }, org.ctx, org.mailboxId, { now });

async function ownAddress(trx: Transaction<DB>, org: Org): Promise<string> {
  const row = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", org.mailboxId)
    .executeTakeFirstOrThrow();
  return row.address;
}

describe("matchReplies: close by reply", () => {
  test("T7 a reply in the thread from a Cc recipient closes the loop `replied` and stores the mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      const mail = await reply(trx, org, { from: JAN, threadKey: loop.threadKey, subject: "Inna sprawa" });
      const out = await run(trx, org);
      expect(out).toEqual({ checked: 1, replied: 1, repliedSubject: 0, dropped: 0, autoMarked: 0 });
      const row = await loopRow(trx, loop.id);
      expect(row.status).toBe("closed");
      expect(row.close_reason).toBe("replied");
      expect(row.closed_by_email_id).toBe(mail);
      expect(row.closed_at?.toISOString()).toBe(RUN_AT.toISOString());
      expect(await closedAudit(trx, org.ctx.orgId, loop.id)).toHaveLength(1);
    });
  });

  test("the reply names the loop message in In-Reply-To or References (a broken thread key)", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const a = await waiting(trx, org);
      const b = await waiting(trx, org);
      const ma = await reply(trx, org, { from: "obcy@example.test", subject: "x", inReplyTo: a.messageId });
      const mb = await reply(trx, org, {
        from: "obcy@example.test",
        subject: "y",
        references: `<z@x.test> ${b.messageId}`,
      });
      expect((await run(trx, org)).replied).toBe(2);
      expect((await loopRow(trx, a.id)).closed_by_email_id).toBe(ma);
      expect((await loopRow(trx, b.id)).closed_by_email_id).toBe(mb);
    });
  });

  test("a delegated loop closes the same way", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: ANNA });
      const loop = await waiting(trx, org, { kind: "delegated", delegate_id: delegateId });
      await reply(trx, org, { threadKey: loop.threadKey });
      expect((await run(trx, org)).replied).toBe(1);
      expect((await loopRow(trx, loop.id)).close_reason).toBe("replied");
    });
  });

  test("the subject rule: `replied_subject` within 30 days from a recipient; not later, not from a stranger", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const near = await waiting(trx, org);
      const far = await waiting(trx, org, { subject: "Inny temat" });
      const stranger = await waiting(trx, org, { subject: "Trzeci temat" });
      const mail = await reply(trx, org, { subject: `RE: Odp: ${SUBJECT}`, at: after(30) });
      await reply(trx, org, { subject: "Re: Inny temat", at: after(31) });
      await reply(trx, org, { subject: "Re: Trzeci temat", from: "obcy@example.test" });
      expect(await run(trx, org, after(40))).toMatchObject({ checked: 3, replied: 0, repliedSubject: 1 });
      expect((await loopRow(trx, near.id)).close_reason).toBe("replied_subject");
      expect((await loopRow(trx, near.id)).closed_by_email_id).toBe(mail);
      expect((await loopRow(trx, far.id)).status).toBe("open");
      expect((await loopRow(trx, stranger.id)).status).toBe("open");
    });
  });

  test("the first match in received order wins, also when its id sorts last", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      // The ids sort against the order of receipt: only the order by `received_at` gives the early mail.
      const bySubject = await reply(trx, org, { at: after(1), id: "ffffffff-0000-4000-8000-000000000001" });
      await reply(trx, org, { at: after(2), threadKey: loop.threadKey, id: "00000000-0000-4000-8000-000000000001" });
      await run(trx, org);
      const row = await loopRow(trx, loop.id);
      expect(row.close_reason).toBe("replied_subject");
      expect(row.closed_by_email_id).toBe(bySubject);
    });
  });

  test("200 mails from a recipient do not hide a reply in the thread", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await recipientMails(trx, org, ANNA, 205);
      const mail = await reply(trx, org, { threadKey: loop.threadKey, at: after(20), subject: "Inna sprawa" });
      expect((await run(trx, org)).replied).toBe(1);
      expect((await loopRow(trx, loop.id)).closed_by_email_id).toBe(mail);
      // The hook reads the same rows.
      const other = await waiting(trx, org, { subject: "Drugi temat" });
      await reply(trx, org, { threadKey: other.threadKey, at: after(21), subject: "x" });
      expect(await loopHooks().isOpen(trx, org.ctx, other.id)).toBe(false);
    });
  });

  test("a mail from the junk folder or with the category spam never closes a loop; an old spam verdict does not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const path = await junkFolder(trx, org);
      const a = await waiting(trx, org, { subject: "A" });
      const b = await waiting(trx, org, { subject: "B" });
      const c = await waiting(trx, org, { subject: "C" });
      await reply(trx, org, { threadKey: a.threadKey, sourceFolder: path });
      await reply(trx, org, { threadKey: b.threadKey, category: "spam" });
      expect(await loopHooks().isOpen(trx, org.ctx, a.id)).toBe(true);
      expect((await run(trx, org)).replied).toBe(0);
      expect((await loopRow(trx, a.id)).status).toBe("open");
      expect((await loopRow(trx, b.id)).status).toBe("open");
      // A mail from another folder counts.
      await reply(trx, org, { threadKey: c.threadKey, sourceFolder: "Archive" });
      expect((await run(trx, org)).replied).toBe(1);
      expect((await loopRow(trx, c.id)).status).toBe("closed");
    });
  });

  test("an out-of-office mail with no Auto-Submitted header (subject prefix) is automatic", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, subject: "Automatic reply: Oferta Q1" });
      expect(await run(trx, org)).toMatchObject({ replied: 0, autoMarked: 1 });
      expect((await loopRow(trx, loop.id)).status).toBe("open");
      expect(await loopHooks().isOpen(trx, org.ctx, loop.id)).toBe(true);
    });
  });

  test("a mail does not count: before or at wait_from_at, from an own address, from no address, in another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      const own = await ownAddress(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, at: WAIT_FROM });
      await reply(trx, org, { threadKey: loop.threadKey, at: after(-1) });
      await reply(trx, org, { threadKey: loop.threadKey, from: own });
      await reply(trx, org, { threadKey: loop.threadKey, from: own.toUpperCase() });
      await reply(trx, org, { threadKey: loop.threadKey, from: null });
      // The same thread in another mailbox of the organization.
      const other = await siblingMailbox(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, mailboxId: other.mailboxId });
      expect(await run(trx, org)).toMatchObject({ checked: 1, replied: 0, repliedSubject: 0 });
      expect((await loopRow(trx, loop.id)).status).toBe("open");
    });
  });

  test("another organization's mail with the same thread key does not close the loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const stranger = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, stranger, { threadKey: loop.threadKey });
      await run(trx, org);
      expect((await loopRow(trx, loop.id)).status).toBe("open");
    });
  });

  test("a promised loop and a closed loop are left alone", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const promised = await waiting(trx, org, { kind: "promised" });
      const closed = await waiting(trx, org, { status: "closed", close_reason: "done", closed_at: after(1) });
      await reply(trx, org, { threadKey: promised.threadKey });
      await reply(trx, org, { threadKey: closed.threadKey });
      expect((await run(trx, org)).checked).toBe(0);
      expect((await loopRow(trx, promised.id)).status).toBe("open");
      expect((await loopRow(trx, closed.id)).close_reason).toBe("done");
    });
  });

  test("an empty To (a DSR erase) closes the loop `dropped`", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org, { to_addresses: [], cc_addresses: [JAN], counterpart: null });
      expect(await run(trx, org)).toMatchObject({ checked: 1, dropped: 1, replied: 0 });
      expect((await loopRow(trx, loop.id)).close_reason).toBe("dropped");
      expect(await closedAudit(trx, org.ctx.orgId, loop.id)).toHaveLength(1);
    });
  });
});

describe("matchReplies: automatic answers", () => {
  test("T8 an out-of-office first, then a real reply: `auto_reply_at` set, the loop closes `replied`", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, at: after(1), autoSubmitted: "auto-replied" });
      // The two steps in two runs: the out-of-office alone leaves the loop open.
      expect((await run(trx, org, after(2))).autoMarked).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("open");
      await reply(trx, org, { threadKey: loop.threadKey, at: after(3), autoSubmitted: "no" });
      expect((await run(trx, org, after(4))).replied).toBe(1);
      const row = await loopRow(trx, loop.id);
      expect(row.close_reason).toBe("replied");
      expect(row.auto_reply_at?.toISOString()).toBe(after(2).toISOString());
    });
  });

  test("an out-of-office and a real reply in one run: both are written", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, at: after(1), precedence: "bulk" });
      const real = await reply(trx, org, { threadKey: loop.threadKey, at: after(2) });
      expect(await run(trx, org)).toMatchObject({ replied: 1, autoMarked: 1 });
      const row = await loopRow(trx, loop.id);
      expect(row.closed_by_email_id).toBe(real);
      expect(row.auto_reply_at).not.toBeNull();
    });
  });

  test("T9 only an out-of-office: the loop stays open, `auto_reply_at` is set once", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { threadKey: loop.threadKey, at: after(1), autoSubmitted: "auto-replied" });
      await reply(trx, org, { from: "mailer-daemon@example.test", threadKey: loop.threadKey, at: after(2) });
      expect(await run(trx, org, after(3))).toMatchObject({ replied: 0, repliedSubject: 0, autoMarked: 1 });
      expect(await run(trx, org, after(4))).toMatchObject({ autoMarked: 0 });
      const row = await loopRow(trx, loop.id);
      expect(row.status).toBe("open");
      expect(row.auto_reply_at?.toISOString()).toBe(after(3).toISOString());
    });
  });

  test("an automatic mail with no match leaves `auto_reply_at` empty; a mail without a header row is not automatic", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org);
      await reply(trx, org, { subject: "Inna sprawa", autoSubmitted: "auto-replied" });
      expect((await run(trx, org)).autoMarked).toBe(0);
      expect((await loopRow(trx, loop.id)).auto_reply_at).toBeNull();
      await reply(trx, org, { threadKey: loop.threadKey });
      expect((await run(trx, org)).replied).toBe(1);
    });
  });
});

describe("matchReplies: follow-up sends of the loop", () => {
  async function loopWithSend(trx: Transaction<DB>, org: Org, sendStatus: string, subject: string = SUBJECT) {
    const loop = await waiting(trx, org, { subject });
    const ids = await insertLoopActionPair(trx, org.ctx, loop.id, {
      draftStatus: "ready",
      sendStatus,
      createdAt: after(2),
      send:
        sendStatus === "approved" ? { approved_at: after(2), approved_by: org.userId, approved_via: "telegram" } : {},
    });
    return { loop, ...ids };
  }

  test("T10 a waiting follow-up and a reply: the loop closes and the send ends `expired` / `loop_closed` in the same run", async () => {
    for (const status of ["awaiting_approval", "approved"]) {
      await withRollback(db, async (trx) => {
        const org = await loopsOrg(trx);
        const { loop, sendId, draftId } = await loopWithSend(trx, org, status);
        await reply(trx, org, { threadKey: loop.threadKey });
        await run(trx, org);
        expect((await loopRow(trx, loop.id)).status).toBe("closed");
        const send = await trx.selectFrom("actions").selectAll().where("id", "=", sendId).executeTakeFirstOrThrow();
        expect(send.status).toBe("expired");
        const audit = await trx
          .selectFrom("audit_log")
          .select("reason_code")
          .where("action_id", "=", sendId)
          .where("event", "=", "action.expired")
          .execute();
        expect(audit.map((row) => row.reason_code)).toEqual(["loop_closed"]);
        const draft = await trx
          .selectFrom("actions")
          .select("status")
          .where("id", "=", draftId)
          .executeTakeFirstOrThrow();
        expect(draft.status).toBe("expired");
      });
    }
  });

  test("a send of another loop is not touched", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const mine = await loopWithSend(trx, org, "awaiting_approval");
      const other = await loopWithSend(trx, org, "awaiting_approval", "Inny temat");
      await reply(trx, org, { threadKey: mine.loop.threadKey });
      await run(trx, org);
      const rows = await trx
        .selectFrom("actions")
        .select(["id", "status"])
        .where("id", "in", [mine.sendId, other.sendId])
        .execute();
      expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
        [mine.sendId]: "expired",
        [other.sendId]: "awaiting_approval",
      });
    });
  });

  test("T11 a reply after the approval and before the committer: `isOpen` is false; a loop without a reply is open", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const answered = await waiting(trx, org);
      const quiet = await waiting(trx, org, { subject: "Inny temat" });
      const promised = await waiting(trx, org, { kind: "promised", subject: "Trzeci temat" });
      const hooks = loopHooks();
      expect(await hooks.isOpen(trx, org.ctx, answered.id)).toBe(true);
      await reply(trx, org, { threadKey: answered.threadKey });
      expect(await hooks.isOpen(trx, org.ctx, answered.id)).toBe(false);
      // The hook only answers: the job closes the loop.
      expect((await loopRow(trx, answered.id)).status).toBe("open");
      expect(await hooks.isOpen(trx, org.ctx, quiet.id)).toBe(true);
      expect(await hooks.isOpen(trx, org.ctx, promised.id)).toBe(true);
      // A promise is not a wait for a reply: a mail in its thread does not stop anything.
      await reply(trx, org, { threadKey: promised.threadKey, subject: "x" });
      expect(await hooks.isOpen(trx, org.ctx, promised.id)).toBe(true);
      // The own address, in any case, is no reply: the send goes on.
      const own = await ownAddress(trx, org);
      await reply(trx, org, { threadKey: quiet.threadKey, from: own.toUpperCase(), subject: "y" });
      expect(await hooks.isOpen(trx, org.ctx, quiet.id)).toBe(true);
      // An automatic answer does not stop the send.
      await reply(trx, org, { threadKey: quiet.threadKey, autoSubmitted: "auto-replied" });
      expect(await hooks.isOpen(trx, org.ctx, quiet.id)).toBe(true);
    });
  });
});

describe("matchReplies: logs", () => {
  test("one `loops_matched` line per reason with a count; no address, subject or id of a mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const a = await waiting(trx, org, { subject: "PLANTED-SUBJECT-13" });
      await waiting(trx, org, { to_addresses: [], counterpart: null });
      await reply(trx, org, {
        threadKey: a.threadKey,
        from: "planted-sender-13@example.test",
        subject: "PLANTED-SUBJECT-13",
      });
      const logs = captureLogs();
      try {
        await run(trx, org);
      } finally {
        logs.stop();
      }
      expect(logProblems(logs.lines, ["PLANTED-SUBJECT-13", "planted-sender-13@example.test", ANNA])).toEqual([]);
      const lines = eventLines(logs.lines, "loops_matched");
      expect(lines.map((line) => [line.kind, line.count]).sort()).toEqual([
        ["dropped", 1],
        ["replied", 1],
      ]);
      expect(lines.every((line) => line.mailbox_id === org.mailboxId)).toBe(true);
    });
  });
});
