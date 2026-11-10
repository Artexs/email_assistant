import { AI_FOLDER_NAMES } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  claimActions,
  createFolderResolver,
  ensureMoved,
  type ApplyDeps,
  type ClaimedAction,
} from "../../src/modules/actions";
import { INBOX, MailNotFoundError, syncMailbox, type MailProvider } from "../../src/modules/mail";
import {
  createFakeMailProvider,
  type FakeMailProvider,
  type FakeMailProviderOptions,
} from "../../src/modules/mail/fake";
import { updateCursor } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import {
  applyDepsDefaults,
  createOrgWithMailbox,
  insertAction,
  insertTestEmail,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(NOW.getTime() - HOUR);
const SINCE = new Date(RECEIVED.getTime() - 86_400_000);

// Interia: a protocol COPY gives a new UID (no MOVE, UIDPLUS); a webmail move keeps it.
const INTERIA: FakeMailProviderOptions = {
  capabilities: { move: false, uidplus: true },
  keepUidOnCopy: false,
  keepUidOnUserMove: true,
};

interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  fake: FakeMailProvider;
}

async function setup(trx: Transaction<DB>, options: FakeMailProviderOptions = INTERIA): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  return { ctx: { orgId: box.orgId }, mailboxId: box.mailboxId, fake: createFakeMailProvider(options) };
}

function depsOf(
  s: Setup,
  trx: Transaction<DB>,
  extra: { folderMap?: Record<string, string>; beforeCommit?: () => void; appendFolders?: string[] } = {}
): ApplyDeps {
  const folders = createFolderResolver(
    {
      db: trx,
      now: () => NOW,
      provider: s.fake,
      mailboxId: s.mailboxId,
      folderMap: extra.folderMap ?? { ...AI_FOLDER_NAMES },
    },
    s.ctx
  );
  return {
    db: trx,
    now: () => NOW,
    mailboxId: s.mailboxId,
    folders,
    ...applyDepsDefaults(),
    appendFolders: new Set(extra.appendFolders ?? []),
    beforeCommit: extra.beforeCommit,
  };
}

function message(id: string) {
  return { messageId: id, from: "sender@x.test", to: ["owner@x.test"], subject: "s", date: RECEIVED };
}

const MESSAGE_ID = "<move-1@x.test>";

function deliver(s: Setup, folder: string, id: string = MESSAGE_ID): number {
  return s.fake.deliver(folder, message(id), { internalDate: RECEIVED });
}

// Inserts a row for the fake message at `folder`/`uid`, with one move action.
async function insertMail(
  trx: Transaction<DB>,
  s: Setup,
  opts: {
    folder?: string;
    sourceFolder?: string;
    uid: number;
    messageId?: string;
    payload?: Record<string, string>;
    status?: string;
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const folder = opts.folder ?? INBOX;
  const meta = await s.fake.fetchMetaIn(folder, opts.uid);
  return insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: opts.messageId ?? MESSAGE_ID,
    folder,
    sourceFolder: opts.sourceFolder,
    uid: opts.uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    movedAt: folder === (opts.sourceFolder ?? INBOX) ? null : RECEIVED,
    actions: [{ type: "move", status: opts.status ?? "ready", payload: opts.payload ?? { folder: "ai_info" } }],
  });
}

async function claim(trx: Transaction<DB>, s: Setup, at: Date = NOW): Promise<ClaimedAction[]> {
  return claimActions(trx, s.ctx, s.mailboxId, {
    now: at,
    limit: 20,
    staleBefore: new Date(at.getTime() - 10 * 60_000),
    filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
  });
}

async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function emailState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditEvents(trx: Transaction<DB>, s: Setup) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

const uidsIn = (s: Setup, folder: string): Promise<number[]> => s.fake.searchSinceIn(folder, SINCE);
const callCount = (s: Setup, method: string): number => s.fake.calls.filter((call) => call === method).length;

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
      expect(Number(email.inbox_uid)).toBe(uid);
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

const REVERSE_AT = new Date(RECEIVED.getTime() + 60_000);

// A mail the system moved to `folder` (original `applied`) with a `ready` reverse. The mail sits in `folder` on the fake.
async function insertMoved(
  trx: Transaction<DB>,
  s: Setup,
  opts: { folder: string; sourceFolder?: string; key: string; uid: number; inboxUid: number; messageId?: string }
): Promise<{ emailId: string; originalId: string; reverseId: string }> {
  const meta = await s.fake.fetchMetaIn(opts.folder, opts.uid);
  const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: opts.messageId ?? MESSAGE_ID,
    folder: opts.folder,
    sourceFolder: opts.sourceFolder,
    uid: opts.uid,
    inboxUid: opts.inboxUid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    movedAt: RECEIVED,
    actions: [{ type: "move", status: "applied", payload: { folder: opts.key } }],
  });
  const originalId = mail.actionIds[0] as string;
  const reverseId = await insertAction(trx, s.ctx, mail.emailId, {
    type: "move",
    status: "ready",
    payload: { folder: opts.key },
    reversesActionId: originalId,
    createdAt: REVERSE_AT,
  });
  return { emailId: mail.emailId, originalId, reverseId };
}

// An identical row that sits in INBOX (no actions).
function insertTestEmailLike(trx: Transaction<DB>, s: Setup, uid: number, hash: string): Promise<string> {
  return insertTestEmail(trx, s.ctx, s.mailboxId, {
    message_id_header: MESSAGE_ID,
    content_hash: hash,
    folder: INBOX,
    uid,
    inbox_uid: uid,
    received_at: RECEIVED,
  });
}

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

describe("reverse move", () => {
  test("(8) the mail goes back to INBOX and the original is undone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const inboxUid = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, inboxUid, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, inboxUid });
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(mail.reverseId);

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, s.fake)).kind).toBe("applied");

      const inbox = await uidsIn(s, INBOX);
      expect(inbox).toHaveLength(1);
      expect(await uidsIn(s, "AI/Info")).toEqual([]);
      const email = await emailState(trx, mail.emailId);
      expect(email).toMatchObject({ folder: INBOX, moved_at: null });
      expect([Number(email.uid), Number(email.inbox_uid)]).toEqual([inbox[0] as number, inbox[0] as number]);
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
      const mail = await insertMoved(trx, s, { folder: INBOX, key: "ai_info", uid, inboxUid: uid });
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
      const inboxUid = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, inboxUid, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, inboxUid });
      const moved = await updateCursor(
        trx,
        s.ctx,
        s.mailboxId,
        { uidValidity: null, lastUid: null },
        { uidValidity: 7, lastUid: inboxUid }
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
      expect(await uidsIn(s, INBOX)).toEqual([inboxUid]);
      expect((await emailState(trx, mail.emailId)).folder).toBe("AI/Info");

      const result = await syncMailbox(
        { db: trx, provider: s.fake, isOwnActionId: async () => false, now: () => NOW },
        s.ctx,
        s.mailboxId
      );
      expect(result.returnedBelowCursor).toBe(1);
      expect((await emailState(trx, mail.emailId)).folder).toBe(INBOX);

      const [again] = await claim(trx, s, new Date(NOW.getTime() + 11 * 60_000));
      expect(again?.id).toBe(mail.reverseId);
      expect(again?.email.folder).toBe(INBOX);
      s.fake.calls.length = 0;
      expect((await applyAction(depsOf(s, trx), s.ctx, again as ClaimedAction, s.fake)).kind).toBe("applied");

      expect(callCount(s, "deleteMessage")).toBe(0);
      expect(await uidsIn(s, INBOX)).toEqual([inboxUid]);
    });
  });

  test("(9c) B2 case B: another row's copy in INBOX is not deleted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = await insertMoved(trx, s, {
        folder: "AI/Spam",
        key: "ai_spam",
        uid: deliver(s, "AI/Spam"),
        inboxUid: 1,
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
      const inboxUid = deliver(s, INBOX);
      const infoUid = s.fake.userMove(INBOX, inboxUid, "AI/Info");
      const mail = await insertMoved(trx, s, { folder: "AI/Info", key: "ai_info", uid: infoUid, inboxUid });
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

describe("ensureMoved", () => {
  const email = (uid: number, hash: string): ClaimedAction["email"] => ({
    id: "e1",
    mailbox_id: "m1",
    folder: INBOX,
    uid,
    inbox_uid: uid,
    source_folder: INBOX,
    message_id_header: MESSAGE_ID,
    content_hash: hash,
    from_address: "sender@x.test",
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

const JUNK = "Wiadomości-śmieci";
const LATER = new Date(NOW.getTime() + 11 * 60_000);

describe("source folder and the rescue", () => {
  test("(1) a forward move of an Oferty mail into AI/Info keeps source_folder and inbox_uid; it uses a MOVE", async () => {
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
      expect(Number(email.inbox_uid)).toBe(uid);
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
      expect(email).toMatchObject({ folder: INBOX, source_folder: JUNK, undo_pending_at: null });
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
        inboxUid: junkUid,
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
      expect(Number(email.inbox_uid)).toBe(Number(email.uid));
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

  test("(7) during the rescue the row has undo_pending_at set", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await rescueMail(trx, s);
      const [action] = await claim(trx, s);
      let seen: Date | null | undefined;
      const provider: MailProvider = {
        ...s.fake,
        async transferByAppend(from, uid, to) {
          seen = (await emailState(trx, mail.emailId)).undo_pending_at;
          return s.fake.transferByAppend(from, uid, to);
        },
      };

      expect((await applyAction(depsOf(s, trx), s.ctx, action as ClaimedAction, provider)).kind).toBe("applied");

      expect(seen?.getTime()).toBe(NOW.getTime());
      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
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
      expect((await emailState(trx, mail.emailId)).undo_pending_at).toBeNull();
    });
  });

  test("(9) the reverse of an INBOX-source mail from AI/Spam into INBOX uses a MOVE", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const inboxUid = deliver(s, INBOX);
      const spamUid = s.fake.userMove(INBOX, inboxUid, "AI/Spam");
      const mail = await insertMoved(trx, s, { folder: "AI/Spam", key: "ai_spam", uid: spamUid, inboxUid });
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
