// GreenMail and committer helpers for the tests of the copy hash: the draft step makes a real copy in a real
// Drafts folder, the test edits that copy like a mail client does, and the committer runs again.
import { randomBytes, randomUUID } from "node:crypto";

import { buildOutgoingMessage, draftPayloadSchema, DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";
import MailComposer from "nodemailer/lib/mail-composer";

import { createCommitterJob, setDelegationId } from "../../src/modules/actions";
import { delegationHooks } from "../../src/modules/delegation";
import { loopHooks } from "../../src/modules/loops";
import {
  composeMessage,
  locateByActionId,
  type FolderMessageMeta,
  type ImapConnectOptions,
  type MailProvider,
} from "../../src/modules/mail";
import { openImapProvider } from "../../src/modules/mail";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  pauseOtherMailboxes,
} from "./fixtures";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
export const IMAP_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
export const IMAP_PORT = Number(process.env.TEST_IMAP_PORT ?? "3143");

export { MINUTE_MS as MINUTE } from "@ea/core";
export const NOW = new Date("2026-11-20T13:05:00Z");
export const CREATED = new Date("2026-11-20T12:00:00Z");
export const HEX64 = /^[0-9a-f]{64}$/;
export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export interface CopyBox {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  /** A second connection of the test: it reads and edits the Drafts folder like a mail client. */
  mailClient: MailProvider;
  sender: FakeMailSender;
  clock: { now: Date };
  /** The wrapper that the committer's connection goes through (fault injection). Default: none. */
  wrap: { provider: (provider: MailProvider) => MailProvider };
  /** Test hook: runs inside `LoopHooks.isOpen` before the loop is read, with the transaction (the loop lock is taken there). */
  onIsOpen: { run?: (trx: Transaction<DB>, loopId: string) => Promise<void> };
  /** Test settings read by the committer at each run: the time budget of the Sent pass before a reply send (ms). Default: none. */
  tune: { sentBudgetMs?: number };
  /** The sends whose cards the committer asked to edit (`ApprovalHooks.onDecided`). */
  decided: { sendId: string; decision: string }[];
  committer: ReturnType<typeof createCommitterJob>;
  /** Closes every connection that the box opened. */
  close(): Promise<void>;
}

export function connectOptions(address: string): ImapConnectOptions {
  return { host: IMAP_HOST, port: IMAP_PORT, user: address, auth: { kind: "password", password: "greenmail-test" } };
}

// The opener of a test that calls a service: it ignores the host of the mailbox row and connects to GreenMail.
export const greenmailOpener = (address: string) => async () => openImapProvider(connectOptions(address));

// A mailbox of a new organization on a GreenMail user, its credentials, and a committer job whose IMAP opener returns a new
// real connection for each run (the committer closes it) and whose SMTP sender is a fake that counts the calls.
export async function copyBox(trx: Transaction<DB>): Promise<CopyBox> {
  await pauseOtherMailboxes(trx);
  const address = `u-${randomUUID()}@localhost`;
  const org = await createOrgWithMailbox(trx, { address });
  const ctx = { orgId: org.orgId };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
    .where("id", "=", org.mailboxId)
    .execute();
  const secret = secrets.encrypt("pw", `mailbox:${org.mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId: org.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  const opened: MailProvider[] = [];
  const mailClient = await openImapProvider(connectOptions(address));
  opened.push(mailClient);
  await mailClient.ensureFolder("Drafts");
  await mailClient.ensureFolder("Sent");
  const sender = createFakeMailSender();
  const clock = { now: NOW };
  const wrap: CopyBox["wrap"] = { provider: (provider) => provider };
  const decided: CopyBox["decided"] = [];
  const tune: CopyBox["tune"] = {};
  const onIsOpen: CopyBox["onIsOpen"] = {};
  const loops = loopHooks();
  const committer = createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => wrap.provider(await openImapProvider(connectOptions(address))),
    openSender: async () => {
      sender.closed = false;
      return sender;
    },
    compose: composeMessage,
    hooks: delegationHooks({ db: trx }),
    approvalHooks: {
      onDecided: async (_trx, _ctx, input) => {
        decided.push({ sendId: input.sendId, decision: input.decision });
      },
    },
    loopHooks: {
      ...loops,
      isOpen: async (trx, ctx, loopId) => {
        await onIsOpen.run?.(trx, loopId);
        return loops.isOpen(trx, ctx, loopId);
      },
    },
    scope: { kind: "all" },
    sendScope: { kind: "all" },
    now: () => clock.now,
    get sentBudgetMs() {
      return tune.sentBudgetMs;
    },
  });
  return {
    ctx,
    userId: org.userId,
    mailboxId: org.mailboxId,
    address,
    mailClient,
    sender,
    clock,
    wrap,
    onIsOpen,
    tune,
    decided,
    committer,
    async close() {
      for (const provider of opened) await provider.close().catch(() => undefined);
    },
  };
}

export async function flagOn(trx: Transaction<DB>, box: CopyBox, flag: "draft_copy_check" | "reply_drafts") {
  await setOrgFeature(trx, box.ctx, { flag, enabled: true, actor: "cli", now: NOW });
}

type PairOpts = NonNullable<Parameters<typeof insertDraftAndSend>[3]>;

// A mail with the draft `ready` and its send `awaiting_approval`: the first committer run makes the copy.
export function waitingPair(trx: Transaction<DB>, box: CopyBox, opts: PairOpts = {}) {
  return insertDraftAndSend(trx, box.ctx, box.mailboxId, {
    draftStatus: "ready",
    createdAt: CREATED,
    from: "boss@x.test",
    subject: "Offer",
    messageId: `<orig-${randomUUID()}@x.test>`,
    bodyText: "Please prepare the offer",
    to: opts.kind === "reply" ? "boss@x.test" : "anna@example.com",
    ...opts,
  });
}

// The tap: the send becomes `approved`.
export async function tap(trx: Transaction<DB>, box: CopyBox, sendId: string): Promise<void> {
  await trx
    .updateTable("actions")
    .set({ status: "approved", approved_at: NOW, approved_by: box.userId, approved_via: "web" })
    .where("id", "=", sendId)
    .execute();
}

export async function actionRow(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function reverseOf(conn: Db | Transaction<DB>, draftId: string) {
  return conn.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).executeTakeFirst();
}

// The copies in the Drafts folder, as the mail client sees them.
export async function draftCopies(box: CopyBox): Promise<FolderMessageMeta[]> {
  // Every message of the folder: a draft that a test made later has the real clock as its date.
  const uids = await box.mailClient.searchSinceIn("Drafts", new Date(0));
  return box.mailClient.fetchByUidsIn("Drafts", uids);
}

export async function copyOf(box: CopyBox, draftId: string): Promise<FolderMessageMeta | null> {
  return locateByActionId(box.mailClient, "Drafts", { actionId: draftId, hintUid: null, since: new Date(DAY_MS) });
}

export interface Edit {
  text?: (text: string) => string;
  subject?: string;
  to?: string[];
  cc?: string[];
  /** A name and content: the text part stays the same. */
  attachment?: { filename: string; content: string };
}

// The mail client saves the draft again: the old message goes, a new one with the same `X-EA-Action-Id` takes its place. An
// empty edit is a re-save with no change (a server may re-encode it). Returns the new UID.
export async function editCopy(box: CopyBox, draftId: string, edit: Edit = {}): Promise<number> {
  const meta = await copyOf(box, draftId);
  if (meta === null) throw new Error("no copy to edit");
  const content = await box.mailClient.fetchContent("Drafts", meta.uid);
  const text = edit.text === undefined ? (content.text ?? "") : edit.text(content.text ?? "");
  const raw = await new MailComposer({
    from: box.address,
    to: edit.to ?? meta.to,
    ...((edit.cc ?? meta.cc).length === 0 ? {} : { cc: edit.cc ?? meta.cc }),
    subject: edit.subject ?? meta.subject ?? "",
    text: text.replace(/\r?\n/g, "\r\n"),
    messageId: meta.messageId ?? `<${randomUUID()}@x.test>`,
    headers: { "X-EA-Action-Id": draftId },
    ...(edit.attachment === undefined ? {} : { attachments: [edit.attachment] }),
  })
    .compile()
    .build();
  await box.mailClient.deleteMessage("Drafts", meta.uid);
  const appended = await box.mailClient.appendMessage("Drafts", raw, ["\\Draft"], CREATED);
  if (appended.uid === null) throw new Error("the server gave no UID");
  return appended.uid;
}

export async function deleteCopy(box: CopyBox, draftId: string): Promise<void> {
  const meta = await copyOf(box, draftId);
  if (meta === null) throw new Error("no copy to delete");
  await box.mailClient.deleteMessage("Drafts", meta.uid);
}

// The text of the draft that the committer builds: for a test that looks for it in the stored rows.
export async function builtText(trx: Transaction<DB>, box: CopyBox, draftId: string, emailId: string): Promise<string> {
  const draft = await actionRow(trx, draftId);
  const email = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
  return buildOutgoingMessage({
    draft: draftPayloadSchema.parse(draft.payload),
    draftActionId: draft.id,
    createdAt: draft.created_at,
    mailbox: { address: box.address },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    original: {
      fromAddress: email.from_address,
      subject: email.subject,
      receivedAt: email.received_at,
      messageId: email.message_id_header,
      inReplyTo: email.in_reply_to,
      references: [],
      bodyText: email.body_text,
    },
  }).text;
}

// A box, its flags, and a pair whose copy the first committer run made. The send still waits for its tap.
export async function seedPair(
  trx: Transaction<DB>,
  tracked: CopyBox[],
  opts: { kind: "delegation" | "reply" | "clarification"; flag: boolean; cc?: string[] }
) {
  const box = await copyBox(trx);
  tracked.push(box);
  // A reply sends only while the flag `reply_drafts` is on.
  await flagOn(trx, box, "reply_drafts");
  if (opts.flag) await flagOn(trx, box, "draft_copy_check");
  let delegation: string | null = null;
  let p: Awaited<ReturnType<typeof waitingPair>>;
  if (opts.kind === "delegation") {
    const delegateId = await insertDelegate(trx, box.ctx, { name: "Anna", email: "anna@example.com" });
    p = await waitingPair(trx, box, { kind: "delegation", delegateId, delegateName: "Anna" });
    delegation = await insertDelegation(trx, box.ctx, {
      mailboxId: box.mailboxId,
      emailId: p.emailId,
      delegateId,
      draftActionId: p.draftId,
      sendActionId: p.sendId,
    });
    await setDelegationId(trx, box.ctx, [p.draftId, p.sendId], delegation);
  } else {
    p = await waitingPair(trx, box, { kind: opts.kind, ...(opts.cc === undefined ? {} : { cc: opts.cc }) });
  }
  await box.committer.run();
  if ((await actionRow(trx, p.draftId)).status !== "applied") throw new Error("the draft was not applied");
  return { box, p, delegation };
}

export async function runSend(trx: Transaction<DB>, box: CopyBox, sendId: string) {
  await tap(trx, box, sendId);
  await box.committer.run();
  return actionRow(trx, sendId);
}
