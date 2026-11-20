import { randomBytes, randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { createCommitterJob } from "../../src/modules/actions";
import { loopHooks } from "../../src/modules/loops";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, pauseOtherMailboxes } from "./fixtures";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

export const NOW = new Date("2026-11-20T10:00:00Z");

// a Friday
export const CREATED = new Date(NOW.getTime() - HOUR_MS);

export const SENT_AT = "2026-11-10T09:30:00.000Z";

export const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);

export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export const run = randomUUID();

export const MARKERS = {
  anna: `marker-anna-${run}@x.test`,
  jan: `marker-jan-${run}@x.test`,
  ewa: `marker-ewa-${run}@x.test`,
  subject: `MARKER-SUBJECT-${run}`,
  quote: `MARKER-QUOTE-${run}`,
};

export interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

export async function setup(trx: Transaction<DB>): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = { drafts: "Drafts", sent: "Sent" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    sender: createFakeMailSender(),
    folderMap,
  };
}

export async function addCredentials(trx: Transaction<DB>, s: Setup): Promise<void> {
  const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
  await insertCredentials(trx, s.ctx, {
    mailboxId: s.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
}

export interface FollowUpOpts {
  draftStatus?: string;
  sendStatus?: string;
  to?: string[];
  cc?: string[];
  // The payload of the send, when it differs from the draft.
  sendTo?: string[];
  loop?: Partial<Parameters<typeof insertLoopRow>[3]>;
  mailboxId?: string;
  n?: 1 | 2;
}

export interface FollowUp {
  loopId: string;
  draftId: string;
  sendId: string;
  draftPayload: DraftPayload;
}

// One loop with its sent mail, and the draft and send of a follow-up for it. An approved send gets its tap.
export async function followUp(trx: Transaction<DB>, s: Setup, opts: FollowUpOpts = {}): Promise<FollowUp> {
  const to = opts.to ?? [MARKERS.anna];
  const cc = opts.cc ?? [MARKERS.jan];
  const mailboxId = opts.mailboxId ?? s.mailboxId;
  const sent = await insertSentRow(trx, s.ctx, mailboxId, {
    toAddresses: to,
    ccAddresses: cc,
    subject: MARKERS.subject,
  });
  await trx.updateTable("sent_emails").set({ body_text: MARKERS.quote }).where("id", "=", sent).execute();
  const loopId = await insertLoopRow(trx, s.ctx, mailboxId, {
    sent_email_id: sent,
    message_id: "<own-1@x.test>",
    references_ids: ["<root@x.test>"],
    subject: MARKERS.subject,
    to_addresses: to,
    cc_addresses: cc,
    counterpart: to[0] ?? null,
    language: "en",
    due_at: new Date(NOW.getTime() - DAY_MS),
    ...opts.loop,
  });
  const draftPayload: DraftPayload = {
    kind: "follow_up",
    loop_id: loopId,
    to,
    cc,
    language: "en",
    sent_at: SENT_AT,
    subject: MARKERS.subject,
    quote: MARKERS.quote,
    n: opts.n ?? 1,
  };
  const sendPayload = { ...sendPayloadFor(draftPayload), ...(opts.sendTo === undefined ? {} : { to: opts.sendTo }) };
  const approved = opts.sendStatus === "approved" || opts.sendStatus === "applied" || opts.sendStatus === "applying";
  const ids = await insertLoopActionPair(trx, s.ctx, loopId, {
    ...(opts.draftStatus === undefined ? {} : { draftStatus: opts.draftStatus }),
    ...(opts.sendStatus === undefined ? {} : { sendStatus: opts.sendStatus }),
    createdAt: CREATED,
    payloads: { draft: draftPayload, send: sendPayload },
    // An applied draft has its copy in the Drafts folder: the reverse row needs the folder and the UID.
    draft: opts.draftStatus === "applied" ? { provider_result: JSON.stringify({ folder: "Drafts", uid: 1 }) } : {},
    send: approved ? { approved_at: at(-1), approved_by: s.userId, approved_via: "telegram" } : {},
  });
  return { loopId, ...ids, draftPayload };
}

export async function tap(trx: Transaction<DB>, s: Setup, sendId: string): Promise<void> {
  await trx
    .updateTable("actions")
    .set({ status: "approved", approved_at: at(-1), approved_by: s.userId, approved_via: "telegram" })
    .where("id", "=", sendId)
    .execute();
}

export function committerOf(
  trx: Transaction<DB>,
  s: Setup,
  clock: { now: Date },
  over: Partial<Parameters<typeof createCommitterJob>[0]> = {}
) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => s.fake,
    // The fake of this test is one object: a real opener returns a new open sender at each run.
    openSender: async () => {
      s.sender.closed = false;
      return s.sender;
    },
    compose: composeMessage,
    scope: { kind: "all" },
    sendScope: { kind: "all" },
    loopHooks: loopHooks(),
    now: () => clock.now,
    ...over,
  });
}

export async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function loopOf(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function draftsCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Drafts", new Date(CREATED.getTime() - DAY_MS))).length;
}

export async function prepare(trx: Transaction<DB>): Promise<Setup> {
  await pauseOtherMailboxes(trx);
  const s = await setup(trx);
  await addCredentials(trx, s);
  return s;
}
