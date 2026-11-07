import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob, type ActionsScope } from "../../src/modules/actions";
import { MailAuthError, type ImapConnectOptions } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials, insertMailbox } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertTriagedWithActions, pauseOtherMailboxes, testCapabilities } from "./fixtures";
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
  orgId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

async function addBox(trx: Transaction<DB>, sameOrgAs?: Box): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  let orgId: string;
  let mailboxId: string;
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
    ({ orgId, mailboxId } = await createOrgWithMailbox(trx, { address }));
  }
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { orgId, mailboxId, address, fake: createFakeMailProvider() };
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

      await jobFor(trx, opener, { kind: "synthetic" }).run();

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

  test("scope all: the test mailbox gets everything, another address acts like off", async () => {
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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address.toUpperCase() }).run();

      for (const id of mail.actionIds) expect((await actionState(trx, id)).status).toBe("applied");
      expect(await flagsOf(box, mail.uid)).toEqual(expect.arrayContaining(["\\Flagged", "\\Seen"]));
      expect((await actionState(trx, otherMail.actionIds[0] as string)).status).toBe("applied");
      expect((await actionState(trx, otherMail.actionIds[1] as string)).status).toBe("ready");
      expect(opener.calls).toEqual([box.address]);
    });
  });

  test("a mailbox with nothing claimable opens no connection", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<r4@x.test>", actions: [{ type: "flag", status: "applied" }] });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "synthetic" }).run();

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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

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

      await jobFor(trx, opener, { kind: "synthetic" }).run();

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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

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

      await expect(
        jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }, failing).run()
      ).resolves.toBeUndefined();

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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

      expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("applied");
    });
  });

  test("the provider is closed after the run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<r9@x.test>", actions: [{ type: "mark_read" }] });
      const opener = openerFor([box]);

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

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

      await jobFor(trx, opener, { kind: "all", mailboxAddress: box.address }).run();

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
