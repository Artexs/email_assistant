import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { applyAction, createFolderResolver, type ClaimedAction } from "../../src/modules/actions";
import { INBOX, type MailProvider } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import {
  NOW,
  Setup,
  setup,
  depsOf,
  deliver,
  insertMail,
  claim,
  actionState,
  emailState,
  auditEvents,
  uidsIn,
  callCount,
  insertMoved,
} from "./actions-move-helpers";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const JUNK = "Wiadomości-śmieci";

const LATER = new Date(NOW.getTime() + 11 * MINUTE_MS);

describe("source folder and the rescue", () => {
  test("(1) a forward move of an Oferty mail into AI/Info keeps source_folder and source_uid; it uses a MOVE", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      deliver(s, "AI/Info", "<filler@x.test>");
      const uid = deliver(s, "Oferty");
      const mail = await insertMail(trx, s, { folder: "Oferty", sourceFolder: "Oferty", uid });
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      const email = await emailState(trx, mail.emailId);
      expect(email.folder).toBe("AI/Info");
      expect(email.source_folder).toBe("Oferty");
      expect(Number(email.source_uid)).toBe(uid);
      expect(Number(email.uid)).toBe(Math.max(...(await uidsIn(s, "AI/Info"))));
      expect(Number(email.uid)).not.toBe(uid);
      expect(email.moved_at?.getTime()).toBe(NOW.getTime());
      expect(callCount(s, "moveMessage")).toBe(1);
      expect(callCount(s, "transferByAppend")).toBe(0);
      expect((await actionState(trx, mail.actionIds[0] as string)).provider_result).toMatchObject({
        moved_now: true,
        by_append: false,
      });
    });
  });

  // A junk mail with `\Flagged` and a ready move `inbox`.
  async function rescueMail(trx: Transaction<DB>, s: Setup) {
    const uid = deliver(s, JUNK);
    await s.fake.setFlags(JUNK, uid, { add: ["\\Flagged"] });
    const mail = await insertMail(trx, s, {
      folder: JUNK,
      sourceFolder: JUNK,
      uid,
      payload: { folder: "inbox" },
    });
    return { ...mail, uid };
  }

  test("(3) the rescue moves the mail into INBOX by APPEND and keeps the flag; the marker is clear after the commit", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      deliver(s, INBOX, "<filler@x.test>");
      const mail = await rescueMail(trx, s);
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "transferByAppend")).toBe(1);
      expect(callCount(s, "moveMessage")).toBe(0);
      const email = await emailState(trx, mail.emailId);
      expect(email).toMatchObject({ folder: INBOX, source_folder: JUNK, move_pending_at: null });
      expect(email.moved_at?.getTime()).toBe(NOW.getTime());
      const inbox = await uidsIn(s, INBOX);
      expect(inbox).toHaveLength(2);
      expect(Number(email.uid)).toBe(Math.max(...inbox));
      expect((await s.fake.fetchMetaIn(INBOX, Number(email.uid)))?.flags).toContain("\\Flagged");
      expect(await uidsIn(s, JUNK)).toEqual([]);
      expect((await actionState(trx, mail.actionIds[0] as string)).provider_result).toMatchObject({
        by_append: true,
      });
    });
  });

  test("(4) the Undo of the rescue moves the mail back into the source folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const junkUid = deliver(s, JUNK, "<filler@x.test>");
      const uid = deliver(s, INBOX);
      const mail = await insertMoved(trx, s, {
        folder: INBOX,
        sourceFolder: JUNK,
        key: "inbox",
        uid,
        uidInInbox: junkUid,
      });
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(mail.reverseId);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "moveMessage")).toBe(1);
      expect(callCount(s, "transferByAppend")).toBe(0);
      const email = await emailState(trx, mail.emailId);
      expect(email).toMatchObject({ folder: JUNK, moved_at: null });
      expect(Number(email.uid)).toBe(Math.max(...(await uidsIn(s, JUNK))));
      expect(Number(email.source_uid)).toBe(Number(email.uid));
      expect(await uidsIn(s, INBOX)).toEqual([]);
      expect(await actionState(trx, mail.originalId)).toMatchObject({ status: "undone" });
    });
  });

  test("(5) a crash between APPEND and EXPUNGE: the retry deletes the source copy", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await rescueMail(trx, s);
      const [action] = await claim(trx, s);
      s.fake.failOn("deleteMessage", new HardError("x"));

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("retry");
      expect(await uidsIn(s, INBOX)).toHaveLength(1);
      expect(await uidsIn(s, JUNK)).toHaveLength(1);

      const [again] = await claim(trx, s, LATER);
      expect(again?.id).toBe(mail.actionIds[0]);
      expect((await applyAction(depsOf(s, trx), s.ctx, again as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(await uidsIn(s, INBOX)).toHaveLength(1);
      expect(await uidsIn(s, JUNK)).toEqual([]);
      expect(callCount(s, "transferByAppend")).toBe(1);
      expect((await actionState(trx, mail.actionIds[0] as string)).provider_result).toMatchObject({
        leftover_deleted: true,
        moved_now: false,
      });
      expect((await emailState(trx, mail.emailId)).folder).toBe(INBOX);
    });
  });

  test("(6) a crash after the IMAP part: the next claim finds the target only, no second APPEND", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await rescueMail(trx, s);
      const [action] = await claim(trx, s);
      const crash = new Error("crash");
      const crashing = depsOf(s, trx, {
        beforeCommit: () => {
          throw crash;
        },
      });

      await expect(applyAction(crashing, s.ctx, action as ClaimedAction, s.fake)).rejects.toBe(crash);
      expect(await uidsIn(s, JUNK)).toEqual([]);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "transferByAppend")).toBe(1);
      expect(await uidsIn(s, INBOX)).toHaveLength(1);
      expect((await emailState(trx, mail.emailId)).folder).toBe(INBOX);
    });
  });

  test("(7) during the rescue the row has move_pending_at set", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await rescueMail(trx, s);
      const [action] = await claim(trx, s);
      let seen: Date | null | undefined;
      const provider: MailProvider = {
        ...s.fake,
        async transferByAppend(from, uid, to) {
          seen = (await emailState(trx, mail.emailId)).move_pending_at;
          return s.fake.transferByAppend(from, uid, to);
        },
      };

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, provider)).kind).toBe("applied");

      expect(seen?.getTime()).toBe(NOW.getTime());
      expect((await emailState(trx, mail.emailId)).move_pending_at).toBeNull();
    });
  });

  test("(8) a rescue whose mail is gone fails with mail_not_found and clears the marker", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await rescueMail(trx, s);
      s.fake.remove(JUNK, mail.uid);
      const [action] = await claim(trx, s);

      expect(await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "mail_not_found",
      });

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
      });
      expect((await emailState(trx, mail.emailId)).move_pending_at).toBeNull();
    });
  });

  test("(9) the reverse of an INBOX-source mail from AI/Spam into INBOX uses a MOVE", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uidInInbox = deliver(s, INBOX);
      const spamUid = s.fake.userMove(INBOX, uidInInbox, "AI/Spam");
      const mail = await insertMoved(trx, s, { folder: "AI/Spam", key: "ai_spam", uid: spamUid, uidInInbox });
      const [action] = await claim(trx, s);
      s.fake.calls.length = 0;

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "moveMessage")).toBe(1);
      expect(callCount(s, "transferByAppend")).toBe(0);
      expect(await emailState(trx, mail.emailId)).toMatchObject({
        folder: INBOX,
        source_folder: INBOX,
        moved_at: null,
      });
      expect((await actionState(trx, mail.reverseId)).provider_result).toMatchObject({ by_append: false });
    });
  });

  test("(10) resolve(inbox) makes no ensureFolder call, no folder_map change, no audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const folders = createFolderResolver(
        { db: trx, now: () => NOW, provider: s.fake, mailboxId: s.mailboxId, folderMap: {} },
        s.ctx
      );

      expect(await folders.resolve("inbox")).toBe(INBOX);

      expect(s.fake.calls).toEqual([]);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("folder_map")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.folder_map).toEqual({ drafts: "Drafts" });
      expect(await auditEvents(trx, s)).toEqual([]);
      expect(await folders.resolve("ai_info")).toBe("AI/Info");
      expect(callCount(s, "ensureFolder")).toBe(1);
    });
  });

  test("(11) a forward payload that is not a key (INBOX): failed / bad_payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliver(s, JUNK);
      const mail = await insertMail(trx, s, { folder: JUNK, sourceFolder: JUNK, uid, payload: { folder: "INBOX" } });
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
    });
  });
});
