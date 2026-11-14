import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob, type ActionsScope } from "../../src/modules/actions";
import {
  configureMailHosts,
  MailAuthError,
  resolveMailHost,
  type ImapConnectOptions,
  type MailSender,
  type SmtpConnectOptions,
} from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials, insertMailbox, insertSyncFolders } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import { setLogLevel } from "../../src/platform/log";

import {
  createOrgWithMailbox,
  insertAction,
  insertDraftAndSend,
  insertTriagedWithActions,
  pauseOtherMailboxes,
  suspendOrg,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(NOW.getTime() - HOUR);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

interface Box {
  userId?: string;
  orgId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

async function addBox(trx: Transaction<DB>, sameOrgAs?: Box): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  let orgId: string;
  let mailboxId: string;
  let userId: string | undefined;
  if (sameOrgAs) {
    orgId = sameOrgAs.orgId;
    mailboxId = randomUUID();
    await insertMailbox(
      trx,
      { orgId },
      {
        id: mailboxId,
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      }
    );
  } else {
    ({ orgId, mailboxId, userId } = await createOrgWithMailbox(trx, { address }));
  }
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { userId, orgId, mailboxId, address, fake: createFakeMailProvider() };
}

interface Mail {
  emailId: string;
  actionIds: string[];
  uid: number;
}

// Delivers a mail to the fake INBOX and inserts the matching row with its actions.
async function addMail(
  trx: Transaction<DB>,
  box: Box,
  opts: {
    messageId: string;
    receivedAt?: Date;
    createdAt?: Date;
    actions: { type: "save_summary" | "flag" | "mark_read" | "move"; status?: string }[];
  }
): Promise<Mail> {
  const receivedAt = opts.receivedAt ?? RECEIVED;
  const uid = box.fake.deliver(
    "INBOX",
    { messageId: opts.messageId, from: "sender@x.test", to: [box.address], subject: "s", date: receivedAt },
    { internalDate: receivedAt }
  );
  const meta = await box.fake.fetchMetaIn("INBOX", uid);
  const mail = await insertTriagedWithActions(trx, { orgId: box.orgId }, box.mailboxId, {
    category: "info",
    createdAt: opts.createdAt ?? receivedAt,
    receivedAt,
    from: "sender@x.test",
    messageId: opts.messageId,
    uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    actions: opts.actions.map((action) => ({ type: action.type, status: action.status ?? "ready" })),
  });
  return { ...mail, uid };
}

interface Opener {
  openProvider(opts: ImapConnectOptions): Promise<FakeMailProvider>;
  calls: string[];
  failures: Map<string, Error>;
}

function openerFor(boxes: Box[]): Opener {
  const calls: string[] = [];
  const failures = new Map<string, Error>();
  return {
    calls,
    failures,
    async openProvider(opts) {
      calls.push(opts.user);
      const failure = failures.get(opts.user);
      if (failure) throw failure;
      const box = boxes.find((candidate) => candidate.address === opts.user);
      if (!box) throw new Error("no fake for this address");
      return box.fake;
    },
  };
}

function jobFor(trx: Transaction<DB>, opener: Opener, scope: ActionsScope, db: Transaction<DB> = trx) {
  return createCommitterJob({ db, secrets, openProvider: opener.openProvider, scope, now: () => NOW });
}

async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function flagsOf(box: Box, uid: number): Promise<string[]> {
  return (await box.fake.fetchMetaIn("INBOX", uid))?.flags ?? [];
}

describe("createCommitterJob", () => {
  test("scope synthetic: summaries and synthetic mail only, one connection", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const synthetic = await addMail(trx, box, {
        messageId: "<s1@ea-seed.test>",
        actions: [{ type: "save_summary" }, { type: "flag" }],
      });
      const real = await addMail(trx, box, { messageId: "<r1@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "synthetic", testMail: NO_TEST_SENDERS }).run();

      expect((await actionState(trx, synthetic.actionIds[0] as string)).status).toBe("applied");
      expect((await actionState(trx, synthetic.actionIds[1] as string)).status).toBe("applied");
      expect(await flagsOf(box, synthetic.uid)).toContain("\\Flagged");
      const held = await actionState(trx, real.actionIds[0] as string);
      expect(held).toMatchObject({ status: "ready", locked_at: null });
      expect(await flagsOf(box, real.uid)).not.toContain("\\Flagged");
      expect(opener.calls).toHaveLength(1);
    });
  });

  test("scope off: only summaries, no connection", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, {
        messageId: "<s2@ea-seed.test>",
        actions: [{ type: "save_summary" }, { type: "flag" }],
      });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "off" }).run();

      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect((await actionState(trx, mail.actionIds[1] as string)).status).toBe("ready");
      expect(opener.calls).toEqual([]);
    });
  });

  test("scope all: every mailbox gets its mailbox changes", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, {
        messageId: "<r3@x.test>",
        actions: [{ type: "save_summary" }, { type: "flag" }, { type: "mark_read" }],
      });
      const other = await addBox(trx);
      const otherMail = await addMail(trx, other, {
        messageId: "<s3@ea-seed.test>",
        actions: [{ type: "save_summary" }, { type: "flag" }],
      });
      const opener = openerFor([box, other]);

      await jobFor(trx, opener, { kind: "all" }).run();

      for (const id of mail.actionIds) expect((await actionState(trx, id)).status).toBe("applied");
      expect(await flagsOf(box, mail.uid)).toEqual(expect.arrayContaining(["\\Flagged", "\\Seen"]));
      expect((await actionState(trx, otherMail.actionIds[0] as string)).status).toBe("applied");
      expect((await actionState(trx, otherMail.actionIds[1] as string)).status).toBe("applied");
      expect([...opener.calls].sort()).toEqual([box.address, other.address].sort());
    });
  });

  test("a mailbox with nothing claimable opens no connection", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<r4@x.test>", actions: [{ type: "flag", status: "applied" }] });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "synthetic", testMail: NO_TEST_SENDERS }).run();

      expect(opener.calls).toEqual([]);
    });
  });

  test("a login failure sets auth_error and releases the batch without a count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { messageId: "<r5@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      opener.failures.set(box.address, new MailAuthError("bad login"));

      await jobFor(trx, opener, { kind: "all" }).run();

      const mailbox = await trx
        .selectFrom("mailboxes")
        .select(["status", "status_changed_at"])
        .where("id", "=", box.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status).toBe("auth_error");
      expect(mailbox.status_changed_at?.getTime()).toBe(NOW.getTime());
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
    });
  });

  test("a soft error stops the mailbox: the first is released with a wait, the rest untouched", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const first = await addMail(trx, box, {
        messageId: "<r6a@x.test>",
        receivedAt: new Date(RECEIVED.getTime() - MINUTE),
        actions: [{ type: "flag" }],
      });
      const second = await addMail(trx, box, { messageId: "<r6b@x.test>", actions: [{ type: "flag" }] });
      box.fake.failOn("setFlags", new SoftError("lost connection"));
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all" }).run();

      const firstState = await actionState(trx, first.actionIds[0] as string);
      expect(firstState).toMatchObject({ status: "ready", locked_at: null, attempts: 0 });
      expect(firstState.next_attempt_at?.getTime()).toBe(NOW.getTime() + 5 * MINUTE);
      expect(await actionState(trx, second.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        next_attempt_at: null,
        attempts: 0,
      });
      expect(box.fake.closed).toBe(true);
    });
  });

  test("one mailbox that fails to open does not stop the next", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const bad = await addBox(trx);
      // The mailboxes are listed by `created_at`: the bad one comes first.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: new Date(NOW.getTime() - HOUR) })
        .where("id", "=", bad.mailboxId)
        .execute();
      const good = await addBox(trx, bad);
      const badMail = await addMail(trx, bad, { messageId: "<r7a@ea-seed.test>", actions: [{ type: "flag" }] });
      const mail = await addMail(trx, good, { messageId: "<r7b@ea-seed.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([bad, good]);
      opener.failures.set(bad.address, new Error("boom"));

      await jobFor(trx, opener, { kind: "synthetic", testMail: NO_TEST_SENDERS }).run();

      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect(opener.calls).toHaveLength(2);
      expect(await actionState(trx, badMail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
    });
  });

  test("an auth error in the middle of a batch sets auth_error and releases the rest without a count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const at = (minutes: number) => new Date(RECEIVED.getTime() - minutes * MINUTE);
      const summary = await addMail(trx, box, {
        messageId: "<r11a@x.test>",
        receivedAt: at(3),
        actions: [{ type: "save_summary" }],
      });
      const current = await addMail(trx, box, {
        messageId: "<r11b@x.test>",
        receivedAt: at(2),
        actions: [{ type: "flag" }],
      });
      const rest = await addMail(trx, box, {
        messageId: "<r11c@x.test>",
        receivedAt: at(1),
        actions: [{ type: "flag" }],
      });
      box.fake.failOn("setFlags", new MailAuthError("login"));
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all" }).run();

      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("status")
        .where("id", "=", box.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status).toBe("auth_error");
      expect((await actionState(trx, summary.actionIds[0] as string)).status).toBe("applied");
      for (const mail of [current, rest]) {
        expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
          status: "ready",
          locked_at: null,
          attempts: 0,
        });
      }
      expect(box.fake.closed).toBe(true);
    });
  });

  // A provider error never escapes applyAction (it is mapped), so the throw comes from the DB write after the IMAP call.
  test("when applyAction throws, the throwing row stays locked and the untried rows are released", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const throwing = await addMail(trx, box, {
        messageId: "<r12a@x.test>",
        receivedAt: new Date(RECEIVED.getTime() - MINUTE),
        actions: [{ type: "flag" }],
      });
      const untried = await addMail(trx, box, { messageId: "<r12b@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      // After the first IMAP flag change, the next write to `actions` fails once.
      let armed = false;
      const failing = new Proxy(trx, {
        get(target, prop) {
          if (prop === "updateTable" && armed) {
            armed = false;
            throw new Error("db write failed");
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const setFlags = box.fake.setFlags.bind(box.fake);
      box.fake.setFlags = async (...args) => {
        await setFlags(...args);
        armed = true;
      };

      await expect(jobFor(trx, opener, { kind: "all" }, failing).run()).resolves.toBeUndefined();

      const held = await actionState(trx, throwing.actionIds[0] as string);
      expect(held).toMatchObject({ status: "ready", attempts: 0 });
      expect(held.locked_at?.getTime()).toBe(NOW.getTime());
      expect(await actionState(trx, untried.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
      expect(box.fake.closed).toBe(true);
    });
  });

  test("a stale locked action is taken back and applied", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { messageId: "<r8@x.test>", actions: [{ type: "flag" }] });
      await trx
        .updateTable("actions")
        .set({ locked_at: new Date(NOW.getTime() - 11 * MINUTE) })
        .where("id", "=", mail.actionIds[0] as string)
        .execute();
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all" }).run();

      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
    });
  });

  test("the provider is closed after the run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<r9@x.test>", actions: [{ type: "mark_read" }] });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all" }).run();

      expect(box.fake.closed).toBe(true);
    });
  });

  test("a ready move older than 24 h expires with an audit row; an old summary is applied", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const old = new Date(NOW.getTime() - 25 * HOUR);
      const mail = await addMail(trx, box, {
        messageId: "<r10@x.test>",
        receivedAt: old,
        actions: [{ type: "save_summary" }, { type: "move" }],
      });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all" }).run();

      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
      expect(await actionState(trx, mail.actionIds[1] as string)).toMatchObject({
        status: "expired",
        status_reason: "stale",
      });
      const audit = await trx
        .selectFrom("audit_log")
        .select(["event", "action_id", "email_id"])
        .where("org_id", "=", box.orgId)
        .where("event", "=", "action.expired")
        .execute();
      expect(audit).toEqual([
        { event: "action.expired", action_id: mail.actionIds[1] as string, email_id: mail.emailId },
      ]);
      expect(box.fake.calls.filter((call) => call === "moveMessage")).toEqual([]);
    });
  });
});

// S4 stage 12: sends in the committer job.
interface SendOpener {
  calls: string[];
  failure: Error | null;
  sender: ReturnType<typeof createFakeMailSender>;
  openSender(opts: SmtpConnectOptions): Promise<MailSender>;
}

function senderOpener(): SendOpener {
  const sender = createFakeMailSender();
  const opener: SendOpener = {
    calls: [],
    failure: null,
    sender,
    async openSender(opts) {
      opener.calls.push(opts.user);
      if (opener.failure) throw opener.failure;
      return sender;
    },
  };
  return opener;
}

function sendJob(
  trx: Transaction<DB>,
  opener: Opener,
  smtp: SendOpener,
  box: Box,
  sendScope: Parameters<typeof createCommitterJob>[0]["sendScope"] = { kind: "all" }
) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: opener.openProvider,
    openSender: smtp.openSender,
    scope: { kind: "all" },
    sendScope,
    now: () => NOW,
  });
}

function pairOf(trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) {
  return insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
    createdAt: new Date(NOW.getTime() - 30 * MINUTE),
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: box.userId as string, at: new Date(NOW.getTime() - MINUTE) },
    ...opts,
  });
}

describe("createCommitterJob with sends", () => {
  test("(24) a batch with only a send opens the provider and the sender once and saves the Sent copy", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box);

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([box.address]);
      expect(smtp.sender.sent).toHaveLength(1);
      expect((await actionState(trx, p.sendId)).status).toBe("applied");
      expect(await box.fake.searchSinceIn("Sent", new Date(NOW.getTime() - 2 * 24 * 60 * MINUTE))).toHaveLength(1);
      expect(smtp.sender.closed).toBe(true);
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(25) a batch with only a reverse draft opens the provider and no sender", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box, { sendStatus: "applied" });
      await insertAction(trx, { orgId: box.orgId }, p.emailId, {
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 1, reason: "sent" },
        reversesActionId: p.draftId,
        idempotencyKey: `${p.draftId}:undo`,
      });
      await box.fake.ensureFolder("Drafts");

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([]);
    });
  });

  test("(25b) a batch with only an applying send (the recovery) opens no sender", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const p = await pairOf(trx, box, { sendStatus: "applying" });

      await sendJob(trx, opener, smtp, box).run();

      expect(opener.calls).toEqual([box.address]);
      expect(smtp.calls).toEqual([]);
      expect(smtp.sender.calls).toEqual([]);
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
    });
  });

  test("(20) a sender that cannot open releases the draft and the send, no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      smtp.failure = new SoftError("smtp down");
      const waiting = await pairOf(trx, box, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        approved: undefined,
      });
      const ready = await pairOf(trx, box);

      await sendJob(trx, opener, smtp, box).run();

      expect(await actionState(trx, waiting.draftId)).toMatchObject({ status: "ready", locked_at: null, attempts: 0 });
      expect(await actionState(trx, ready.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(21) a soft error on an earlier row releases a later send as approved", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const mail = await addMail(trx, box, { messageId: "<f1@x.test>", actions: [{ type: "flag" }] });
      const p = await pairOf(trx, box);
      box.fake.failOn("setFlags", new SoftError("slow"));

      await sendJob(trx, opener, smtp, box).run();

      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({ status: "ready", locked_at: null });
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.calls).not.toContain("send");
    });
  });

  test("(22) the info line counts sent 1", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    setLogLevel("info");
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const box = await addBox(trx);
        await pairOf(trx, box);

        await sendJob(trx, openerFor([box]), senderOpener(), box).run();

        const output = logSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
        expect(output).toContain(`committer ${box.mailboxId}: applied 1, failed 0, retry 0, sent 1`);
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("(26) facts that cannot load release the batch without a count and close the connections", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const smtp = senderOpener();
      const ready = await pairOf(trx, box);
      // The first organizations read is the suspend re-check of the loop; the facts read after it fails.
      let organizationReads = 0;
      const failing = new Proxy(trx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === "selectFrom") {
            return (table: string) => {
              if (table === "organizations" && ++organizationReads > 1) throw new Error("db read failed");
              return (value as (name: string) => unknown).call(target, table);
            };
          }
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const job = createCommitterJob({
        db: failing,
        secrets,
        openProvider: openerFor([box]).openProvider,
        openSender: smtp.openSender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      });

      await expect(job.run()).resolves.toBeUndefined();

      expect(await actionState(trx, ready.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.sent).toEqual([]);
      expect(box.fake.closed).toBe(true);
    });
  });

  test("(22b) a mailbox with only a held send logs the held line once over two runs", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    setLogLevel("info");
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const box = await addBox(trx);
        const smtp = senderOpener();
        await pairOf(trx, box);
        const job = sendJob(trx, openerFor([box]), smtp, box, { kind: "off" });

        await job.run();
        await job.run();

        const output = logSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
        const line = `committer ${box.mailboxId}: SEND_SCOPE=off, 1 approved sends wait`;
        expect(output.split(line)).toHaveLength(2);
        expect(smtp.calls).toEqual([]);
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("the Undo of a move into a sort folder (U11)", () => {
  const OFFERS = "Oferty";
  const JUNK = "Wiadomości-śmieci";
  const LATER = new Date(NOW.getTime() + 30 * MINUTE);

  // A mail whose source folder is `Oferty`, moved into AI/Info, with a `ready` reverse. The mail sits in AI/Info on the fake.
  async function movedFromOffers(trx: Transaction<DB>, enabled: boolean) {
    await pauseOtherMailboxes(trx);
    const box = await addBox(trx);
    box.fake = createFakeMailProvider({
      capabilities: { move: false, uidplus: true },
      keepUidOnCopy: false,
      keepUidOnUserMove: true,
    });
    const ctx = { orgId: box.orgId };
    await insertSyncFolders(
      trx,
      ctx,
      box.mailboxId,
      [
        { key: "offers", path: OFFERS, role: "sort" },
        { key: "junk", path: JUNK, role: "junk" },
      ],
      NOW
    );
    if (!enabled) {
      await trx
        .updateTable("mailbox_folders")
        .set({ enabled: false })
        .where("mailbox_id", "=", box.mailboxId)
        .where("key", "=", "offers")
        .execute();
    }
    const message = {
      messageId: "<u11@x.test>",
      from: "sender@x.test",
      to: [box.address],
      subject: "s",
      date: RECEIVED,
    };
    const offersUid = box.fake.deliver(OFFERS, message, { internalDate: RECEIVED });
    const infoUid = box.fake.userMove(OFFERS, offersUid, "AI/Info");
    const meta = await box.fake.fetchMetaIn("AI/Info", infoUid);
    const mail = await insertTriagedWithActions(trx, ctx, box.mailboxId, {
      category: "info",
      createdAt: RECEIVED,
      receivedAt: RECEIVED,
      from: "sender@x.test",
      messageId: "<u11@x.test>",
      folder: "AI/Info",
      sourceFolder: OFFERS,
      uid: infoUid,
      inboxUid: offersUid,
      contentHash: contentHash(meta as NonNullable<typeof meta>),
      movedAt: RECEIVED,
      actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" }, appliedAt: RECEIVED }],
    });
    const reverseId = await insertAction(trx, ctx, mail.emailId, {
      type: "move",
      status: "ready",
      payload: { folder: "ai_info" },
      reversesActionId: mail.actionIds[0],
      createdAt: new Date(RECEIVED.getTime() + MINUTE),
    });
    return { box, ctx, mail, reverseId, offersUid };
  }

  async function emailState(trx: Transaction<DB>, id: string) {
    return trx.selectFrom("emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  }

  for (const enabled of [true, false]) {
    test(`(2) the reverse goes back into Oferty by APPEND (row ${enabled ? "enabled" : "disabled"})`, async () => {
      await withRollback(db, async (trx) => {
        const { box, mail, reverseId } = await movedFromOffers(trx, enabled);
        box.fake.calls.length = 0;

        await jobFor(trx, openerFor([box]), { kind: "all" }).run();

        expect(box.fake.calls).toContain("transferByAppend");
        expect(box.fake.calls).not.toContain("moveMessage");
        const inOffers = await box.fake.searchSinceIn(OFFERS, new Date(RECEIVED.getTime() - 86_400_000));
        expect(inOffers).toHaveLength(1);
        const email = await emailState(trx, mail.emailId);
        expect(email).toMatchObject({ folder: OFFERS, source_folder: OFFERS, moved_at: null, undo_pending_at: null });
        expect(Number(email.uid)).toBe(inOffers[0] as number);
        expect(Number(email.inbox_uid)).toBe(inOffers[0] as number);
        expect(await actionState(trx, reverseId)).toMatchObject({
          status: "applied",
          provider_result: { by_append: true },
        });
        expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("undone");
      });
    });
  }

  test("(2b) a crash between the APPEND and the EXPUNGE: the next claim deletes the AI/Info copy", async () => {
    await withRollback(db, async (trx) => {
      const { box, mail, reverseId } = await movedFromOffers(trx, true);
      const opener = openerFor([box]);
      box.fake.failOn("deleteMessage", new HardError("x"));
      const scope = { kind: "all" } as const;

      await jobFor(trx, opener, scope).run();

      const since = new Date(RECEIVED.getTime() - 86_400_000);
      expect(await box.fake.searchSinceIn(OFFERS, since)).toHaveLength(1);
      expect(await box.fake.searchSinceIn("AI/Info", since)).toHaveLength(1);
      expect(await actionState(trx, reverseId)).toMatchObject({ status: "ready", locked_at: null });

      await createCommitterJob({
        db: trx,
        secrets,
        openProvider: opener.openProvider,
        scope,
        now: () => LATER,
      }).run();

      const inOffers = await box.fake.searchSinceIn(OFFERS, since);
      expect(inOffers).toHaveLength(1);
      expect(await box.fake.searchSinceIn("AI/Info", since)).toEqual([]);
      expect(box.fake.calls.filter((call) => call === "transferByAppend")).toHaveLength(1);
      expect(await actionState(trx, reverseId)).toMatchObject({ status: "applied" });
      expect(Number((await emailState(trx, mail.emailId)).uid)).toBe(inOffers[0] as number);
    });
  });

  test("(2c) a failing sync folder load releases the batch and makes no IMAP call", async () => {
    await withRollback(db, async (trx) => {
      const { box, reverseId } = await movedFromOffers(trx, true);
      const opener = openerFor([box]);
      const failing = new Proxy(trx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === "selectFrom") {
            return (table: string) => {
              if (table === "mailbox_folders") throw new Error("db read failed");
              return (value as (name: string) => unknown).call(target, table);
            };
          }
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      box.fake.calls.length = 0;

      await expect(jobFor(trx, opener, { kind: "all" }, failing).run()).resolves.toBeUndefined();

      expect(await actionState(trx, reverseId)).toMatchObject({ status: "ready", locked_at: null, attempts: 0 });
      expect(opener.calls).toEqual([]);
      expect(box.fake.calls).toEqual([]);
    });
  });

  test("(3) the Undo of a rescue goes back into the junk folder by MOVE, not APPEND", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      box.fake = createFakeMailProvider({ capabilities: { move: true, uidplus: true } });
      const ctx = { orgId: box.orgId };
      await insertSyncFolders(trx, ctx, box.mailboxId, [{ key: "junk", path: JUNK, role: "junk" }], NOW);
      const message = {
        messageId: "<u11-rescue@x.test>",
        from: "sender@x.test",
        to: [box.address],
        subject: "s",
        date: RECEIVED,
      };
      const junkUid = box.fake.deliver(JUNK, message, { internalDate: RECEIVED });
      const inboxUid = box.fake.userMove(JUNK, junkUid, "INBOX");
      const meta = await box.fake.fetchMetaIn("INBOX", inboxUid);
      const mail = await insertTriagedWithActions(trx, ctx, box.mailboxId, {
        category: "info",
        createdAt: RECEIVED,
        receivedAt: RECEIVED,
        from: "sender@x.test",
        messageId: "<u11-rescue@x.test>",
        folder: "INBOX",
        sourceFolder: JUNK,
        uid: inboxUid,
        inboxUid,
        contentHash: contentHash(meta as NonNullable<typeof meta>),
        movedAt: RECEIVED,
        actions: [{ type: "move", status: "applied", payload: { folder: "inbox" }, appliedAt: RECEIVED }],
      });
      const reverseId = await insertAction(trx, ctx, mail.emailId, {
        type: "move",
        status: "ready",
        payload: { folder: "inbox" },
        reversesActionId: mail.actionIds[0],
        createdAt: new Date(RECEIVED.getTime() + MINUTE),
      });
      box.fake.calls.length = 0;

      await jobFor(trx, openerFor([box]), { kind: "all" }).run();

      expect(box.fake.calls).toContain("moveMessage");
      expect(box.fake.calls).not.toContain("transferByAppend");
      expect(await actionState(trx, reverseId)).toMatchObject({
        status: "applied",
        provider_result: { by_append: false },
      });
      expect((await emailState(trx, mail.emailId)).folder).toBe(JUNK);
    });
  });
});

describe("createCommitterJob with a suspended organization", () => {
  test("mailbox changes and sends of a suspended organization wait; the active one is served in the same run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      await suspendOrg(trx, b.orgId);
      const mailA = await addMail(trx, a, { messageId: "<a1@x.test>", actions: [{ type: "flag" }] });
      const mailB = await addMail(trx, b, { messageId: "<b1@x.test>", actions: [{ type: "flag" }] });
      const sendA = await pairOf(trx, a);
      const sendB = await pairOf(trx, b, {
        approved: { userId: b.userId as string, at: new Date(NOW.getTime() - HOUR) },
      });
      const opener = openerFor([a, b]);
      const smtp = senderOpener();

      await sendJob(trx, opener, smtp, a).run();

      expect((await actionState(trx, mailA.actionIds[0] as string)).status).toBe("applied");
      expect(await flagsOf(a, mailA.uid)).toContain("\\Flagged");
      expect((await actionState(trx, sendA.sendId)).status).toBe("applied");
      expect(await actionState(trx, mailB.actionIds[0] as string)).toMatchObject({ status: "ready", locked_at: null });
      expect(await flagsOf(b, mailB.uid)).not.toContain("\\Flagged");
      expect(await actionState(trx, sendB.sendId)).toMatchObject({ status: "approved", locked_at: null });
      expect(opener.calls).toEqual([a.address]);
      expect(smtp.calls).toEqual([a.address]);
    });
  });
});

describe("createCommitterJob: a refused host blocks the mailbox", () => {
  // The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
  afterEach(() => {
    configureMailHosts({ allowLocal: true });
  });

  function refuse(...hosts: string[]): void {
    configureMailHosts({
      allowLocal: false,
      lookup: async (host) => [{ address: hosts.includes(host) ? "10.0.0.7" : "93.184.216.34", family: 4 }],
    });
  }

  async function mailboxOf(trx: Transaction<DB>, box: Box) {
    return trx
      .selectFrom("mailboxes")
      .select(["status", "status_changed_at"])
      .where("id", "=", box.mailboxId)
      .executeTakeFirstOrThrow();
  }

  async function blockAudit(trx: Transaction<DB>, box: Box) {
    return trx
      .selectFrom("audit_log")
      .select(["actor", "data"])
      .where("org_id", "=", box.orgId)
      .where("event", "=", "mailbox.host_blocked")
      .execute();
  }

  test("an SMTP host that the guard refuses blocks the mailbox and releases the send with no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const guardedSmtp = smtp.openSender;
      smtp.openSender = async (opts) => {
        await resolveMailHost(opts.host);
        return guardedSmtp(opts);
      };
      const p = await pairOf(trx, box);
      refuse("smtp.x.test");

      await sendJob(trx, opener, smtp, box).run();

      expect(await mailboxOf(trx, box)).toEqual({ status: "host_blocked", status_changed_at: NOW });
      expect(await blockAudit(trx, box)).toEqual([
        { actor: "system", data: { mailbox_id: box.mailboxId, source: "committer" } },
      ]);
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.sent).toHaveLength(0);
    });
  });

  test("a failed DNS lookup of the SMTP host at send time keeps the mailbox active, with no block and no audit row", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const guardedSmtp = smtp.openSender;
      smtp.openSender = async (opts) => {
        await resolveMailHost(opts.host);
        return guardedSmtp(opts);
      };
      await pairOf(trx, box);
      configureMailHosts({
        allowLocal: false,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      });
      const warnings = spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await sendJob(trx, opener, smtp, box).run();
      } finally {
        warnings.mockRestore();
      }

      expect((await mailboxOf(trx, box)).status).toBe("active");
      expect(await blockAudit(trx, box)).toEqual([]);
      expect(smtp.sender.sent).toHaveLength(0);
    });
  });

  test("an IMAP host that the guard refuses blocks the mailbox and releases the move with no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { messageId: "<h1@x.test>", actions: [{ type: "move" }] });
      const opener = openerFor([box]);
      const open = opener.openProvider;
      opener.openProvider = async (opts) => {
        await resolveMailHost(opts.host);
        return open(opts);
      };
      refuse("imap.x.test");

      await jobFor(trx, opener, { kind: "all" }).run();

      expect(await mailboxOf(trx, box)).toEqual({ status: "host_blocked", status_changed_at: NOW });
      expect(await blockAudit(trx, box)).toHaveLength(1);
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
    });
  });

  test("another opener error does not block the mailbox", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<h2@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      opener.failures.set(box.address, new Error("boom"));
      const errors = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await jobFor(trx, opener, { kind: "all" }).run();
      } finally {
        errors.mockRestore();
      }

      expect((await mailboxOf(trx, box)).status).toBe("active");
      expect(await blockAudit(trx, box)).toEqual([]);
    });
  });
});
