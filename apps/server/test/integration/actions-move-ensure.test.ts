import { afterAll, describe, expect, test } from "bun:test";

import { applyAction, ensureMoved, type ClaimedAction } from "../../src/modules/actions";
import { INBOX, MailNotFoundError } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { SoftError } from "../../src/platform/errors";

import {
  NOW,
  RECEIVED,
  INTERIA,
  setup,
  depsOf,
  message,
  MESSAGE_ID,
  deliver,
  insertMail,
  claim,
  actionState,
  emailState,
  auditEvents,
  uidsIn,
  callCount,
} from "./actions-move-helpers";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("original move: the ensure", () => {
  test("(1) a COPY with a new UID: INBOX is empty, the target holds the mail, the row gets the new UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      // A filler in the target makes the new UID differ from the source UID.
      deliver(s, "AI/Info", "<filler@x.test>");
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({ kind: "applied" });

      expect(await uidsIn(s, INBOX)).toEqual([]);
      const target = await uidsIn(s, "AI/Info");
      expect(target).toHaveLength(2);
      const targetUid = Math.max(...target);
      expect(targetUid).not.toBe(uid);
      const email = await emailState(trx, mail.emailId);
      expect(email.folder).toBe("AI/Info");
      expect(Number(email.source_uid)).toBe(uid);
      expect(Number(email.uid)).toBe(targetUid);
      expect(email.moved_at?.getTime()).toBe(NOW.getTime());
      const state = await actionState(trx, mail.actionIds[0] as string);
      expect(state).toMatchObject({ status: "applied", provider_result: { moved_now: true } });
      const audit = (await auditEvents(trx, s)).filter((row) => row.event === "action.applied");
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action_id).toBe(mail.actionIds[0]);
      expect(audit[0]?.email_id).toBe(mail.emailId);
      expect(audit[0]?.data).toMatchObject({ action_type: "move", folder_key: "ai_info", reverse: false });
    });
  });

  test("(2) with MOVE and a COPYUID the row gets newUid", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { capabilities: { move: true } });
      deliver(s, "AI/Info", "<filler@x.test>");
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      const email = await emailState(trx, mail.emailId);
      expect(Number(email.uid)).toBe(Math.max(...(await uidsIn(s, "AI/Info"))));
      expect(Number(email.uid)).not.toBe(uid);
    });
  });

  test("(3) without a COPYUID the locate finds the UID in the target", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, copyUidMap: false });
      deliver(s, "AI/Info", "<filler@x.test>");
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      const email = await emailState(trx, mail.emailId);
      expect(Number(email.uid)).toBe(Math.max(...(await uidsIn(s, "AI/Info"))));
      expect(email.folder).toBe("AI/Info");
    });
  });

  test("(5) a leftover in the target: the source copy is deleted, no second move", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const leftover = deliver(s, "AI/Info");
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "deleteMessage")).toBe(1);
      expect(callCount(s, "moveMessage")).toBe(0);
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect(await uidsIn(s, "AI/Info")).toEqual([leftover]);
      expect(Number((await emailState(trx, mail.emailId)).uid)).toBe(leftover);
      expect((await actionState(trx, mail.actionIds[0] as string)).provider_result).toMatchObject({
        leftover_deleted: true,
        moved_now: false,
      });
    });
  });

  test("(6) the mail is in the target already: no IMAP write", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const moved = s.fake.userMove(INBOX, uid, "AI/Info");
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "moveMessage")).toBe(0);
      expect(callCount(s, "deleteMessage")).toBe(0);
      expect(Number((await emailState(trx, mail.emailId)).uid)).toBe(moved);
    });
  });

  test("(7) the mail is nowhere: failed / mail_not_found, no notice", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      s.fake.remove(INBOX, uid);
      const [action] = await claim(trx, s);

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "mail_not_found",
      });

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
        notified_at: null,
      });
      const failed = (await auditEvents(trx, s)).filter((row) => row.event === "action.failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.action_id).toBe(mail.actionIds[0]);
    });
  });

  test("(10) ensureFolder runs once per key; a different real path goes into folder_map", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, pathDelimiter: "." });
      const first = await insertMail(trx, s, { uid: deliver(s, INBOX, "<m10a@x.test>"), messageId: "<m10a@x.test>" });
      const second = await insertMail(trx, s, { uid: deliver(s, INBOX, "<m10b@x.test>"), messageId: "<m10b@x.test>" });
      const claimed = await claim(trx, s);
      expect(claimed).toHaveLength(2);
      const deps = depsOf(s, trx);

      for (const action of claimed) {
        expect((await applyAction(deps, s.ctx, action, s.fake)).kind).toBe("applied");
      }

      expect(callCount(s, "ensureFolder")).toBe(1);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("folder_map")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.folder_map).toMatchObject({ ai_info: "AI.Info", drafts: "Drafts" });
      for (const mail of [first, second]) {
        expect((await emailState(trx, mail.emailId)).folder).toBe("AI.Info");
      }
      const created = (await auditEvents(trx, s)).filter((row) => row.event === "mailbox.folder_created");
      expect(created).toHaveLength(1);
      expect(created[0]?.data).toMatchObject({ mailbox_id: s.mailboxId, folder_key: "ai_info" });
    });
  });

  test("(11) an unknown folder key: failed / bad_payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid, payload: { folder: "nope" } });
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "bad_payload",
      });

      expect(s.fake.calls).toEqual([]);
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "failed",
        status_reason: "bad_payload",
      });
      const failed = (await auditEvents(trx, s)).filter((row) => row.event === "action.failed");
      expect(failed[0]).toMatchObject({ reason_code: "bad_payload", action_id: mail.actionIds[0] });
    });
  });

  test("(12) a soft error from moveMessage: retry, no change to the mail row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);
      s.fake.failOn("moveMessage", new SoftError("lost connection"));

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "retry",
        soft: true,
      });

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
      expect(await emailState(trx, mail.emailId)).toMatchObject({ folder: INBOX, moved_at: null });
      expect(Number((await emailState(trx, mail.emailId)).uid)).toBe(uid);
    });
  });

  test("(13) the mail leaves the source during the move: the ensure runs again", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);
      s.fake.failOn("moveMessage", new MailNotFoundError("gone"));

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "moveMessage")).toBe(2);
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect((await emailState(trx, mail.emailId)).folder).toBe("AI/Info");
    });
  });

  test("(15) B2 case A: another row's copy in the target is not deleted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await insertMail(trx, s, {
        folder: "AI/Spam",
        uid: deliver(s, "AI/Spam"),
        status: "applied",
        payload: { folder: "ai_spam" },
      });
      const uid = deliver(s, INBOX);
      const second = await insertMail(trx, s, { uid, payload: { folder: "ai_spam" } });
      const firstBefore = await emailState(trx, first.emailId);
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(second.actionIds[0]);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(await uidsIn(s, "AI/Spam")).toHaveLength(2);
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect(callCount(s, "deleteMessage")).toBe(0);
      expect((await actionState(trx, second.actionIds[0] as string)).provider_result).toMatchObject({
        moved_now: true,
      });
      expect(await emailState(trx, first.emailId)).toEqual(firstBefore);
    });
  });

  test("(16) B2 with a real leftover next to another row's copy: the source is deleted, both copies stay", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertMail(trx, s, {
        folder: "AI/Spam",
        uid: deliver(s, "AI/Spam"),
        status: "applied",
        payload: { folder: "ai_spam" },
      });
      const uid = deliver(s, INBOX);
      const second = await insertMail(trx, s, { uid, payload: { folder: "ai_spam" } });
      const leftover = deliver(s, "AI/Spam");
      const [action] = await claim(trx, s);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "deleteMessage")).toBe(1);
      expect(callCount(s, "moveMessage")).toBe(0);
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect(await uidsIn(s, "AI/Spam")).toHaveLength(2);
      expect(Number((await emailState(trx, second.emailId)).uid)).toBe(leftover);
      expect((await actionState(trx, second.actionIds[0] as string)).provider_result).toMatchObject({
        leftover_deleted: true,
      });
    });
  });
});

describe("the crash test", () => {
  test("(4) a crash before the DB commit: the second run applies with no second move", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMail(trx, s, { uid });
      const [action] = await claim(trx, s);
      const crash = new Error("crash");
      const crashing = depsOf(s, trx, {
        beforeCommit: () => {
          throw crash;
        },
      });

      await expect(applyAction(crashing, s.ctx, action as ClaimedAction, s.fake)).rejects.toBe(crash);

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({ status: "ready" });
      expect((await actionState(trx, mail.actionIds[0] as string)).locked_at).not.toBeNull();
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect(await uidsIn(s, "AI/Info")).toHaveLength(1);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "moveMessage")).toBe(1);
      expect(await uidsIn(s, "AI/Info")).toHaveLength(1);
      expect((await auditEvents(trx, s)).filter((row) => row.event === "action.applied")).toHaveLength(1);
      expect((await emailState(trx, mail.emailId)).folder).toBe("AI/Info");
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({ status: "applied" });
    });
  });
});

describe("ensureMoved", () => {
  const email = (uid: number, hash: string): NonNullable<ClaimedAction["email"]> => ({
    id: "e1",
    mailbox_id: "m1",
    folder: INBOX,
    uid,
    source_uid: uid,
    source_folder: INBOX,
    message_id_header: MESSAGE_ID,
    content_hash: hash,
    from_address: "sender@x.test",
    from_name: null,
    to_addresses: [],
    received_at: RECEIVED,
    subject: "s",
    body_text: null,
    in_reply_to: null,
    references_header: null,
    thread_key: "t1",
  });
  const none = { from: new Set<number>(), to: new Set<number>() };

  test("(14) B1: from equals to never deletes or moves", async () => {
    const fake = createFakeMailProvider(INTERIA);
    const uid = fake.deliver(INBOX, message(MESSAGE_ID), { internalDate: RECEIVED });
    const meta = await fake.fetchMetaIn(INBOX, uid);
    const row = email(uid, contentHash(meta as NonNullable<typeof meta>));
    fake.calls.length = 0;

    expect(await ensureMoved(fake, row, INBOX, INBOX, { fromUid: uid, toUid: uid }, none, { byAppend: false })).toEqual(
      {
        uid,
        movedNow: false,
        leftoverDeleted: false,
      }
    );
    expect(fake.calls).not.toContain("deleteMessage");
    expect(fake.calls).not.toContain("moveMessage");

    fake.remove(INBOX, uid);
    fake.calls.length = 0;
    expect(
      await ensureMoved(fake, row, INBOX, INBOX, { fromUid: uid, toUid: uid }, none, { byAppend: false })
    ).toBeNull();
    expect(fake.calls).not.toContain("deleteMessage");
    expect(fake.calls).not.toContain("moveMessage");
  });
});
