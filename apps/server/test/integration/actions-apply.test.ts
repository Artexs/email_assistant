import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  claimActions,
  createFolderResolver,
  RETRY_WAIT_MS,
  type ApplyDeps,
  type ClaimedAction,
} from "../../src/modules/actions";
import { MailAuthError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { applyDepsDefaults, createOrgWithMailbox, insertAction, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(NOW.getTime() - HOUR);
const MESSAGE_ID = "<apply-1@x.test>";

interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  fake: FakeMailProvider;
}

async function setup(trx: Transaction<DB>): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  return { ctx: { orgId: box.orgId }, mailboxId: box.mailboxId, fake: createFakeMailProvider() };
}

function depsAt(s: Setup, trx: Transaction<DB>, at: Date = NOW): ApplyDeps {
  const folders = createFolderResolver(
    { db: trx, now: () => at, provider: s.fake, mailboxId: s.mailboxId, folderMap: {} },
    s.ctx
  );
  return { db: trx, now: () => at, mailboxId: s.mailboxId, folders, ...applyDepsDefaults() };
}

// Delivers `messageId` to `folder` so that it gets `uid`; filler mails with other ids fill the gap.
// `after` = the highest UID in use in the folder.
function deliverAt(s: Setup, folder: string, uid: number, after = 0): number {
  let last = after;
  while (last < uid - 1) {
    last = s.fake.deliver(folder, {
      messageId: `<filler-${folder}-${last}-${uid}@x.test>`,
      from: "filler@x.test",
      to: ["owner@x.test"],
      subject: "filler",
      date: RECEIVED,
    });
  }
  return s.fake.deliver(
    folder,
    { messageId: MESSAGE_ID, from: "sender@x.test", to: ["owner@x.test"], subject: "s", date: RECEIVED },
    { internalDate: RECEIVED }
  );
}

async function hashOf(s: Setup, folder: string, uid: number): Promise<string> {
  const meta = await s.fake.fetchMetaIn(folder, uid);
  return contentHash(meta as NonNullable<typeof meta>);
}

async function flagsAt(s: Setup, folder: string, uid: number): Promise<string[]> {
  return (await s.fake.fetchMetaIn(folder, uid))?.flags ?? [];
}

// Inserts a mail row whose identity is that of the fake message at `fakeUid`; the row says `rowUid`.
async function insertMail(
  trx: Transaction<DB>,
  s: Setup,
  opts: {
    folder?: string;
    fakeUid: number;
    rowUid: number;
    inboxUid?: number | null;
    movedAt?: Date | null;
    actions: { type: "save_summary" | "flag" | "mark_read"; status: string }[];
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const folder = opts.folder ?? "INBOX";
  const hash = await hashOf(s, folder, opts.fakeUid);
  const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: MESSAGE_ID,
    folder,
    uid: opts.rowUid,
    inboxUid: opts.inboxUid,
    contentHash: hash,
    movedAt: opts.movedAt,
    actions: opts.actions,
  });
  return mail;
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

// m8: every committer audit row carries the action id and the mail id.
async function auditRows(trx: Transaction<DB>, s: Setup) {
  const rows = await trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("event", "like", "action.%")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const row of rows) {
    expect(row.action_id).not.toBeNull();
    expect(row.email_id).not.toBeNull();
  }
  return rows;
}

describe("applyAction", () => {
  test("a type with no handler yet is released in its status with no count and waits 5 min", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "ready" }],
      });
      const [claimed] = await claim(trx, s);
      const action = { ...(claimed as ClaimedAction), type: "send" } as ClaimedAction;
      expect(action.locked_at).not.toBeNull();

      expect(await applyAction(depsAt(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "not_handled" });
      expect(await flagsAt(s, "INBOX", uid)).toEqual([]);
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
      expect((await actionState(trx, mail.actionIds[0] as string)).next_attempt_at?.getTime()).toBe(
        NOW.getTime() + RETRY_WAIT_MS
      );
      expect(await auditRows(trx, s)).toHaveLength(0);
    });
  });

  test("save_summary is applied without a provider call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertMail(trx, s, {
        fakeUid: deliverAt(s, "INBOX", 1),
        rowUid: 1,
        actions: [{ type: "save_summary", status: "ready" }],
      });
      const [action] = await claim(trx, s);
      const callsBefore = [...s.fake.calls];

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, null)).toEqual({ kind: "applied" });
      expect(s.fake.calls).toEqual(callsBefore);
      const state = await actionState(trx, mail.actionIds[0] as string);
      expect(state).toMatchObject({ status: "applied", locked_at: null });
      expect(state.applied_at?.getTime()).toBe(NOW.getTime());
      const audit = await auditRows(trx, s);
      expect(audit.map((row) => row.event)).toEqual(["action.applied"]);
      expect(audit[0]?.action_id).toBe(mail.actionIds[0]);
      expect(audit[0]?.email_id).toBe(mail.emailId);
    });
  });

  test("flag and mark_read set the IMAP flag and record the UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [
          { type: "flag", status: "ready" },
          { type: "mark_read", status: "ready" },
        ],
      });
      const claimed = await claim(trx, s);
      expect(claimed).toHaveLength(2);

      const flag = claimed.find((a) => a.type === "flag") as ClaimedAction;
      expect(await applyAction(depsAt(s, trx), s.ctx, flag, s.fake)).toEqual({ kind: "applied" });
      expect(await flagsAt(s, "INBOX", uid)).toEqual(["\\Flagged"]);
      const flagState = await actionState(trx, flag.id);
      expect(flagState).toMatchObject({ status: "applied", provider_result: { uid } });
      expect(flagState.updated_at.getTime()).toBe(NOW.getTime());

      const read = claimed.find((a) => a.type === "mark_read") as ClaimedAction;
      expect(await applyAction(depsAt(s, trx), s.ctx, read, s.fake)).toEqual({ kind: "applied" });
      expect(await flagsAt(s, "INBOX", uid)).toEqual(["\\Flagged", "\\Seen"]);

      const audit = await auditRows(trx, s);
      expect(audit.map((row) => [row.event, row.email_id])).toEqual([
        ["action.applied", mail.emailId],
        ["action.applied", mail.emailId],
      ]);
      expect(audit[0]?.data).toMatchObject({ action_type: "flag", mailbox_id: s.mailboxId, reverse: false });
    });
  });

  test("a changed UID is found by search and stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 7);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: 5,
        actions: [{ type: "flag", status: "ready" }],
      });
      const [action] = await claim(trx, s);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({ kind: "applied" });
      expect(await flagsAt(s, "INBOX", 7)).toEqual(["\\Flagged"]);
      const email = await emailState(trx, mail.emailId);
      expect(Number(email.uid)).toBe(7);
      expect(Number(email.inbox_uid)).toBe(7);
      expect((await actionState(trx, mail.actionIds[0] as string)).provider_result).toEqual({ uid: 7 });
      await auditRows(trx, s);
    });
  });

  test("a reverse flag of a moved mail keeps inbox_uid and moved_at when the folder UID changes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const movedAt = new Date(NOW.getTime() - 30 * 60_000);
      const uid = deliverAt(s, "AI/Info", 7);
      await s.fake.setFlags("AI/Info", uid, { add: ["\\Flagged"] });
      const mail = await insertMail(trx, s, {
        folder: "AI/Info",
        fakeUid: uid,
        rowUid: 5,
        inboxUid: 3,
        movedAt,
        actions: [{ type: "flag", status: "applied" }],
      });
      const reverse = await insertAction(trx, s.ctx, mail.emailId, {
        type: "flag",
        status: "ready",
        reversesActionId: mail.actionIds[0],
        createdAt: RECEIVED,
      });
      const [action] = await claim(trx, s);
      expect(action?.id).toBe(reverse);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({ kind: "applied" });
      const email = await emailState(trx, mail.emailId);
      expect(Number(email.uid)).toBe(7);
      expect(Number(email.inbox_uid)).toBe(3);
      expect(email.moved_at?.getTime()).toBe(movedAt.getTime());
      expect(await flagsAt(s, "AI/Info", uid)).toEqual([]);
      await auditRows(trx, s);
    });
  });

  test("two identical copies in one folder: the flag goes to the row's own copy", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = deliverAt(s, "AI/Spam", 3);
      const second = deliverAt(s, "AI/Spam", 8, 3);
      expect([first, second]).toEqual([3, 8]);
      const one = await insertMail(trx, s, {
        folder: "AI/Spam",
        fakeUid: 3,
        rowUid: 3,
        actions: [{ type: "save_summary", status: "applied" }],
      });
      const two = await insertMail(trx, s, {
        folder: "AI/Spam",
        fakeUid: 3,
        rowUid: 5,
        actions: [{ type: "flag", status: "ready" }],
      });
      const [action] = await claim(trx, s);
      expect(action?.email_id).toBe(two.emailId);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({ kind: "applied" });
      expect(await flagsAt(s, "AI/Spam", 8)).toEqual(["\\Flagged"]);
      expect(await flagsAt(s, "AI/Spam", 3)).toEqual([]);
      expect(Number((await emailState(trx, two.emailId)).uid)).toBe(8);
      expect(Number((await emailState(trx, one.emailId)).uid)).toBe(3);
      await auditRows(trx, s);
    });
  });

  test("a mail that is not in the folder fails with mail_not_found", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "ready" }],
      });
      s.fake.remove("INBOX", uid);
      const [action] = await claim(trx, s);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "failed",
        reason: "mail_not_found",
      });
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
        notified_at: null,
        attempts: 0,
        locked_at: null,
      });
      const audit = await auditRows(trx, s);
      expect(audit.map((row) => [row.event, row.reason_code])).toEqual([["action.failed", "mail_not_found"]]);
    });
  });

  test("a soft error releases the action without an attempt", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "ready" }],
      });
      s.fake.failOn("setFlags", new SoftError("lost connection"));
      const [action] = await claim(trx, s);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "retry",
        soft: true,
      });
      const state = await actionState(trx, mail.actionIds[0] as string);
      expect(state).toMatchObject({ status: "ready", attempts: 0, locked_at: null, last_error: "SoftError" });
      expect(state.next_attempt_at?.getTime()).toBe(NOW.getTime() + RETRY_WAIT_MS);
      expect(state.updated_at.getTime()).toBe(NOW.getTime());
    });
  });

  test("the third hard error fails the action", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "ready" }],
      });
      const id = mail.actionIds[0] as string;
      s.fake.failOn("setFlags", new HardError("boom"), 3);

      const outcomes = [];
      for (const attempt of [0, 1, 2]) {
        const at = new Date(NOW.getTime() + attempt * 10 * 60_000);
        const [action] = await claim(trx, s, at);
        expect(action?.attempts).toBe(attempt);
        outcomes.push(await applyAction(depsAt(s, trx, at), s.ctx, action as ClaimedAction, s.fake));
        if (attempt < 2) {
          expect(await actionState(trx, id)).toMatchObject({ status: "ready", attempts: attempt + 1 });
        }
      }
      expect(outcomes).toEqual([
        { kind: "retry", soft: false },
        { kind: "retry", soft: false },
        { kind: "failed", reason: "hard_error" },
      ]);
      expect(await actionState(trx, id)).toMatchObject({
        status: "failed",
        status_reason: "hard_error",
        attempts: 3,
        last_error: "HardError",
      });
      const audit = await auditRows(trx, s);
      expect(audit.map((row) => [row.event, row.reason_code])).toEqual([["action.failed", "hard_error"]]);
      expect(audit[0]?.data).toEqual({ attempts: 3, error: "HardError" });
    });
  });

  test("a reverse flag removes the flag and marks the original undone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      await s.fake.setFlags("INBOX", uid, { add: ["\\Flagged"] });
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "applied" }],
      });
      const original = mail.actionIds[0] as string;
      const reverse = await insertAction(trx, s.ctx, mail.emailId, {
        type: "flag",
        status: "ready",
        reversesActionId: original,
        createdAt: RECEIVED,
      });
      const [action] = await claim(trx, s);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({ kind: "applied" });
      expect(await flagsAt(s, "INBOX", uid)).toEqual([]);
      expect(await actionState(trx, reverse)).toMatchObject({ status: "applied" });
      expect(await actionState(trx, original)).toMatchObject({ status: "undone", status_reason: "undo" });
      const audit = await auditRows(trx, s);
      expect(audit.map((row) => [row.event, row.action_id])).toEqual([
        ["action.applied", reverse],
        ["action.undone", original],
      ]);
      expect(audit[1]?.data).toEqual({ reverse_action_id: reverse });
    });
  });

  test("an auth error changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      const mail = await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [{ type: "flag", status: "ready" }],
      });
      s.fake.failOn("setFlags", new MailAuthError("login"));
      const [action] = await claim(trx, s);

      expect(await applyAction(depsAt(s, trx), s.ctx, action as ClaimedAction, s.fake)).toEqual({
        kind: "auth_error",
      });
      const state = await actionState(trx, mail.actionIds[0] as string);
      expect(state).toMatchObject({ status: "ready", attempts: 0 });
      expect(state.locked_at?.getTime()).toBe(NOW.getTime());
      expect(await auditRows(trx, s)).toEqual([]);
    });
  });

  test("a lost claim gives lost and no audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = deliverAt(s, "INBOX", 1);
      await insertMail(trx, s, {
        fakeUid: uid,
        rowUid: uid,
        actions: [
          { type: "save_summary", status: "ready" },
          { type: "flag", status: "ready" },
        ],
      });
      const claimed = await claim(trx, s);
      expect(claimed).toHaveLength(2);

      for (const action of claimed) {
        const stolen = { ...action, locked_at: new Date(NOW.getTime() + 1) };
        expect(await applyAction(depsAt(s, trx), s.ctx, stolen, s.fake)).toEqual({ kind: "lost" });
      }
      expect(await auditRows(trx, s)).toEqual([]);
    });
  });
});
