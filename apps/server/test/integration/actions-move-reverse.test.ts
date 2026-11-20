import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { applyAction, type ClaimedAction } from "../../src/modules/actions";
import { INBOX, syncMailbox } from "../../src/modules/mail";
import { updateCursor } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB } from "../../src/platform/db";

import {
  NOW,
  RECEIVED,
  INTERIA,
  Setup,
  setup,
  depsOf,
  MESSAGE_ID,
  deliver,
  claim,
  actionState,
  emailState,
  auditEvents,
  uidsIn,
  callCount,
  insertMoved,
} from "./actions-move-helpers";
import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// An identical row that sits in INBOX (no actions).
function insertTestEmailLike(trx: Transaction<DB>, s: Setup, uid: number, hash: string): Promise<string> {
  return insertTestEmail(trx, s.ctx, s.mailboxId, {
    message_id_header: MESSAGE_ID,
    content_hash: hash,
    folder: INBOX,
    uid,
    source_uid: uid,
    received_at: RECEIVED,
  });
}

describe("reverse move", () => {
  test("(8) the mail goes back to INBOX and the original is undone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uidInInbox = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, uidInInbox, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, uidInInbox });
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(mail.reverseId);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      const inbox = await uidsIn(s, INBOX);
      expect(inbox).toHaveLength(1);
      expect(await uidsIn(s, "AI/Info")).toEqual([]);
      const email = await emailState(trx, mail.emailId);
      expect(email).toMatchObject({ folder: INBOX, moved_at: null });
      expect([Number(email.uid), Number(email.source_uid)]).toEqual([inbox[0] as number, inbox[0] as number]);
      expect(await actionState(trx, mail.reverseId)).toMatchObject({ status: "applied" });
      expect(await actionState(trx, mail.originalId)).toMatchObject({ status: "undone", status_reason: "undo" });
      const reverseApplied = (await auditEvents(trx, s)).filter(
        (row) => row.event === "action.applied" && row.action_id === mail.reverseId
      );
      expect(reverseApplied[0]?.data).toMatchObject({ reverse: true, folder_key: "ai_info" });
      const undone = (await auditEvents(trx, s)).filter((row) => row.event === "action.undone");
      expect(undone).toHaveLength(1);
      expect(undone[0]).toMatchObject({ action_id: mail.originalId, email_id: mail.emailId });
      expect(undone[0]?.data).toMatchObject({ reverse_action_id: mail.reverseId });
    });
  });

  test("(9) after the sync marked the mail returned: no IMAP write", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, INBOX);
      const mail = await insertMoved(trx, s, { folder: INBOX, key: "ai_info", uid, uidInInbox: uid });
      await trx.updateTable("emails").set({ returned_at: NOW }).where("id", "=", mail.emailId).execute();
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "deleteMessage")).toBe(0);
      expect(callCount(s, "moveMessage")).toBe(0);
      expect(await uidsIn(s, INBOX)).toEqual([uid]);
      expect((await actionState(trx, mail.reverseId)).provider_result).toMatchObject({ moved_now: false });
      expect(await actionState(trx, mail.originalId)).toMatchObject({ status: "undone" });
    });
  });

  test("(9b) a crash after the move, then the sync marks it returned: the retry never deletes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { ...INTERIA, keepUidOnCopy: true, uidValidity: 7 });
      const uidInInbox = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, uidInInbox, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, uidInInbox });
      const moved = await updateCursor(
        trx,
        s.ctx,
        s.mailboxId,
        { uidValidity: null, lastUid: null },
        { uidValidity: 7, lastUid: uidInInbox }
      );
      expect(moved).toBe(true);
      const [action] = await claim(trx, s);
      const crash = new Error("crash");
      const crashing = depsOf(s, trx, {
        beforeCommit: () => {
          throw crash;
        },
      });
      await expect(applyAction(crashing, s.ctx, action as ClaimedAction, s.fake)).rejects.toBe(crash);
      expect(await uidsIn(s, INBOX)).toEqual([uidInInbox]);
      expect((await emailState(trx, mail.emailId)).folder).toBe("AI/Info");

      const result = await syncMailbox(
        { db: trx, provider: s.fake, isOwnActionId: async () => false, now: () => NOW },
        s.ctx,
        s.mailboxId
      );
      expect(result.returnedBelowCursor).toBe(1);
      expect((await emailState(trx, mail.emailId)).folder).toBe(INBOX);

      const [again] = await claim(trx, s, new Date(NOW.getTime() + 11 * MINUTE_MS));
      expect(again?.id).toBe(mail.reverseId);
      expect(again?.email?.folder).toBe(INBOX);
      s.fake.calls.length = 0;
      expect((await applyAction(depsOf(s, trx), s.ctx, again as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "deleteMessage")).toBe(0);
      expect(await uidsIn(s, INBOX)).toEqual([uidInInbox]);
    });
  });

  test("(9c) B2 case B: another row's copy in INBOX is not deleted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await insertMoved(trx, s, {
        folder: "AI/Spam",
        key: "ai_spam",
        uid: deliver(s, "AI/Spam"),
        uidInInbox: 1,
      });
      const otherUid = deliver(s, INBOX);
      const meta = await s.fake.fetchMetaIn(INBOX, otherUid);
      const second = await insertTestEmailLike(trx, s, otherUid, contentHash(meta as NonNullable<typeof meta>));
      s.fake.calls.length = 0;
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(first.reverseId);
      const secondBefore = await emailState(trx, second);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(await uidsIn(s, INBOX)).toHaveLength(2);
      expect(await uidsIn(s, "AI/Spam")).toEqual([]);
      expect(callCount(s, "deleteMessage")).toBe(0);
      const row = await emailState(trx, first.emailId);
      expect(row.folder).toBe(INBOX);
      expect(Number(row.uid)).not.toBe(otherUid);
      expect(await emailState(trx, second)).toEqual(secondBefore);
    });
  });

  test("(9d) a reverse on a mail that is nowhere: failed / mail_not_found, not notified", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uidInInbox = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, uidInInbox, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, uidInInbox });
      s.fake.remove("AI/Info", infoUid);
      const [action] = await claim(trx, s);

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "mail_not_found",
      });

      expect(await actionState(trx, mail.reverseId)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
        notified_at: null,
      });
      expect(await actionState(trx, mail.originalId)).toMatchObject({ status: "applied" });
    });
  });
});
