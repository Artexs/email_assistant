import { randomBytes, randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { createCommitterJob, type ActionsScope } from "../../src/modules/actions";
import { type ImapConnectOptions, type MailSender, type SmtpConnectOptions } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials, insertMailbox } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, insertTriagedWithActions, testCapabilities } from "./fixtures";

export const NOW = new Date("2026-11-07T12:00:00Z");

export const RECEIVED = new Date(NOW.getTime() - HOUR_MS);

export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export interface Box {
  userId?: string;
  orgId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

export async function addBox(trx: Transaction<DB>, sameOrgAs?: Box): Promise<Box> {
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

export interface Mail {
  emailId: string;
  actionIds: string[];
  uid: number;
}

// Delivers a mail to the fake INBOX and inserts the matching row with its actions.
export async function addMail(
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

export interface Opener {
  openProvider(opts: ImapConnectOptions): Promise<FakeMailProvider>;
  calls: string[];
  failures: Map<string, Error>;
}

export function openerFor(boxes: Box[]): Opener {
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

export function jobFor(trx: Transaction<DB>, opener: Opener, scope: ActionsScope, db: Transaction<DB> = trx) {
  return createCommitterJob({ db, secrets, openProvider: opener.openProvider, scope, now: () => NOW });
}

export async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function flagsOf(box: Box, uid: number): Promise<string[]> {
  return (await box.fake.fetchMetaIn("INBOX", uid))?.flags ?? [];
}

// Sends in the committer job.
export interface SendOpener {
  calls: string[];
  failure: Error | null;
  sender: ReturnType<typeof createFakeMailSender>;
  openSender(opts: SmtpConnectOptions): Promise<MailSender>;
}

export function senderOpener(): SendOpener {
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

export function sendJob(
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

export function pairOf(trx: Transaction<DB>, box: Box, opts: Parameters<typeof insertDraftAndSend>[3] = {}) {
  return insertDraftAndSend(trx, { orgId: box.orgId }, box.mailboxId, {
    createdAt: new Date(NOW.getTime() - 30 * MINUTE_MS),
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: box.userId as string, at: new Date(NOW.getTime() - MINUTE_MS) },
    ...opts,
  });
}
