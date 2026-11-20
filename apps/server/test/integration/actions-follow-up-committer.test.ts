import { randomBytes, randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import {
  applySend,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
  type ClaimedAction,
  type SendLimitHit,
} from "../../src/modules/actions";
import { isOwnActionId, sentOriginOf } from "../../src/modules/actions";
import { heldReason, type HeldReasonDeps } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { loopHooks } from "../../src/modules/loops";
import { composeMessage, setSentSync } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { syncSentHeaders } from "../../src/modules/mail/sent-sync";
import { configureFeatures } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { captureLogs, logProblems } from "../log-capture";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";
import { depsOf as sentDepsOf, newOrg, put, siblingMailbox } from "./mail-sent-fixtures";

// The follow-up kind goes through the committer. A follow-up hangs on a loop (`loop_id`), not on a mail.
// Every test runs in a transaction that is rolled back: a committed loop row would break the Down guard of the migration test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z"); // a Friday
const CREATED = new Date(NOW.getTime() - HOUR_MS);
const SENT_AT = "2026-11-10T09:30:00.000Z";
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const run = randomUUID();
const MARKERS = {
  anna: `marker-anna-${run}@x.test`,
  jan: `marker-jan-${run}@x.test`,
  ewa: `marker-ewa-${run}@x.test`,
  subject: `MARKER-SUBJECT-${run}`,
  quote: `MARKER-QUOTE-${run}`,
};

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

async function setup(trx: Transaction<DB>): Promise<Setup> {
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

async function addCredentials(trx: Transaction<DB>, s: Setup): Promise<void> {
  const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
  await insertCredentials(trx, s.ctx, {
    mailboxId: s.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
}

interface FollowUpOpts {
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

interface FollowUp {
  loopId: string;
  draftId: string;
  sendId: string;
  draftPayload: DraftPayload;
}

// One loop with its sent mail, and the draft and send of a follow-up for it. An approved send gets its tap.
async function followUp(trx: Transaction<DB>, s: Setup, opts: FollowUpOpts = {}): Promise<FollowUp> {
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

async function tap(trx: Transaction<DB>, s: Setup, sendId: string): Promise<void> {
  await trx
    .updateTable("actions")
    .set({ status: "approved", approved_at: at(-1), approved_by: s.userId, approved_via: "telegram" })
    .where("id", "=", sendId)
    .execute();
}

function committerOf(
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

async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function loopOf(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditOf(conn: Db | Transaction<DB>, actionId: string, event: string) {
  return conn
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .execute();
}

async function draftsCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Drafts", new Date(CREATED.getTime() - DAY_MS))).length;
}

async function sentCount(s: Setup): Promise<number> {
  return (await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - DAY_MS))).length;
}

async function prepare(trx: Transaction<DB>): Promise<Setup> {
  await pauseOtherMailboxes(trx);
  const s = await setup(trx);
  await addCredentials(trx, s);
  return s;
}

describe("T5 a follow-up through the committer", () => {
  test("the draft copy comes first; no mail goes out before the tap; then one mail to To and Cc, in the thread", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { cc: [MARKERS.jan, MARKERS.ewa] });
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);

      // The draft is made while the send waits for the tap. Nothing is sent: the committer never sends without approval.
      await committer.run();
      expect(await draftsCount(s)).toBe(1);
      expect((await row(trx, p.draftId)).status).toBe("applied");
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");
      clock.now = at(5);
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");

      await tap(trx, s, p.sendId);
      clock.now = at(10);
      await committer.run();

      expect(s.sender.sent).toHaveLength(1);
      expect(s.sender.sent[0]?.envelope).toEqual({ from: s.address, to: [MARKERS.anna, MARKERS.jan, MARKERS.ewa] });
      const raw = s.sender.sent[0]?.raw.toString("latin1") ?? "";
      expect(raw).toContain(`To: ${MARKERS.anna}`);
      expect(raw.replace(/\r\n\s+/g, " ")).toContain(`Cc: ${MARKERS.jan}, ${MARKERS.ewa}`);
      expect(raw).toContain("In-Reply-To: <own-1@x.test>");
      expect(raw.replace(/\r\n\s+/g, " ")).toContain("References: <root@x.test> <own-1@x.test>");
      expect(raw).toMatch(new RegExp(`^x-ea-action-id: ${p.draftId}$`, "im"));
      const send = await row(trx, p.sendId);
      expect(send.status).toBe("applied");
      expect(send.email_id).toBeNull();
      expect(send.loop_id).toBe(p.loopId);
      expect(await sentCount(s)).toBe(1);

      // The loop counts the follow-up and waits again: at least 3 working days (Wed 25 Nov, 17:00 Warsaw).
      const loop = await loopOf(trx, p.loopId);
      expect(loop.follow_ups_sent).toBe(1);
      expect(loop.last_follow_up_at?.getTime()).toBe(at(10).getTime());
      expect(loop.wait_from_at.getTime()).toBe(at(10).getTime());
      expect(loop.due_at.toISOString()).toBe("2026-11-25T16:00:00.000Z");
      expect(loop.message_id).toBe(send.outgoing_message_id);
      expect(loop.references_ids).toEqual(["<root@x.test>", "<own-1@x.test>"]);
      expect(loop.status).toBe("open");
      // The audit rows of a loop action hold the action id and no mail id.
      const applied = await auditOf(trx, p.sendId, "action.applied");
      expect(applied).toHaveLength(1);
      expect(applied[0]?.email_id).toBeNull();
      expect(applied[0]?.data).toMatchObject({ kind: "follow_up", recipients: 3 });
    });
  });

  test("a second tap of the same send makes no second mail (the row is applied)", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);
      await committer.run();
      clock.now = at(3);
      await committer.run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(1);
    });
  });
});

describe("T6 a loop that closes", () => {
  test("a loop closed after the tap: no SMTP, the send ends expired / loop_closed, the draft copy is removed", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s);
      const clock = { now: NOW };
      const committer = committerOf(trx, s, clock);
      await committer.run();
      expect(await draftsCount(s)).toBe(1);

      await tap(trx, s, p.sendId);
      await trx
        .updateTable("open_loops")
        .set({ status: "closed", close_reason: "replied", closed_at: at(1), updated_at: at(1) })
        .where("id", "=", p.loopId)
        .execute();
      clock.now = at(5);
      await committer.run();

      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "loop_closed",
        locked_at: null,
      });
      const expired = await auditOf(trx, p.sendId, "action.expired");
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ reason_code: "loop_closed", email_id: null });
      // The draft copy goes with it: a reverse row removes it.
      const reverses = await trx
        .selectFrom("actions")
        .selectAll()
        .where("reverses_action_id", "=", p.draftId)
        .execute();
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({ email_id: null, loop_id: p.loopId });
      clock.now = at(10);
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect((await row(trx, p.draftId)).status).toBe("undone");
      // The follow-up counters did not move.
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);
    });
  });

  test("a loop that closes before the draft is made: no Drafts copy, the send and the draft end", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-30) } });
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      expect((await row(trx, p.draftId)).status).toBe("expired");
    });
  });

  test("a loop that is not in the mailbox of the committer run is not touched", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const other = await createOrgWithMailbox(trx);
      const foreign: Setup = { ...s, ctx: { orgId: other.orgId }, mailboxId: other.mailboxId, userId: other.userId };
      const p = await followUp(trx, foreign, { draftStatus: "applied", sendStatus: "approved" });
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });
    });
  });
});

describe("T7 the send limits count follow-ups and their Cc", () => {
  async function countedLoopSends(trx: Transaction<DB>, s: Setup, count: number, cc: string[]): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const other = await followUp(trx, s, { cc, draftStatus: "applied", sendStatus: "applied" });
      await trx
        .updateTable("actions")
        .set({ send_started_at: at(-30 - index), applied_at: at(-30 - index) })
        .where("id", "=", other.sendId)
        .execute();
    }
  }

  test("a Cc recipient at its daily limit holds the follow-up: no SMTP, approved, one audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      await countedLoopSends(trx, s, 5, [MARKERS.jan]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved", cc: [MARKERS.jan] });
      const hits: SendLimitHit[] = [];
      const committer = committerOf(trx, s, { now: NOW }, { onSendLimited: (_ctx, hit) => void hits.push(hit) });
      await committer.run();
      expect(s.sender.sent).toHaveLength(0);
      const held = await row(trx, p.sendId);
      expect(held).toMatchObject({ status: "approved", last_error: "send_limit:recipient_day", send_started_at: null });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.limit).toBe("recipient_day");
      expect(await auditOf(trx, p.sendId, "action.send_limited")).toHaveLength(1);
    });
  });

  test("follow-ups that went out count in the mailbox limit: the next one is held, the To alone is not at a limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      // Two earlier follow-ups to other people used the hour of this mailbox.
      await countedLoopSends(trx, s, 2, [MARKERS.ewa]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const limits = { mailboxHour: 2, mailboxDay: 100, recipientDay: 5 };
      await committerOf(trx, s, { now: NOW }, { sendLimits: limits }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", last_error: "send_limit:mailbox_hour" });
    });
  });

  test("below the limits the same follow-up goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      await countedLoopSends(trx, s, 1, [MARKERS.ewa]);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const limits = { mailboxHour: 2, mailboxDay: 100, recipientDay: 5 };
      await committerOf(trx, s, { now: NOW }, { sendLimits: limits }).run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });
});

// The applySend tests use one claimed action, as the crash tests of the other kinds do.
function applyDepsOf(s: Setup, conn: Db | Transaction<DB>, time: Date, over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    db: conn,
    now: () => time,
    mailboxId: s.mailboxId,
    folders: createFolderResolver(
      { db: conn, now: () => time, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
      s.ctx
    ),
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: s.sender,
    hooks: noDelegationHooks,
    loopHooks: loopHooks(),
    appendFolders: new Set(),
    ...over,
  };
}

async function claimOne(trx: Transaction<DB>, s: Setup, id: string, time: Date): Promise<ClaimedAction> {
  const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });
  const action = claimed.find((entry) => entry.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

describe("T8 a crash after the SMTP call never sends a second mail and counts one follow-up", () => {
  test("a copy in Sent proves the send: the recovery ends applied, the loop counts one", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      // The draft copy that the committer would have appended: the bytes of the message.
      const afterSend = () => {
        throw new Error("crash");
      };
      const first = await claimOne(trx, s, p.sendId, NOW);
      await expect(applySend(applyDepsOf(s, trx, NOW, { afterSend }), s.ctx, first, s.fake)).rejects.toThrow("crash");
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applying");
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);

      // The mail server saved a copy in Sent.
      await s.fake.appendMessage("Sent", s.sender.sent[0]?.raw as Buffer, ["\\Seen"], NOW);
      const time = at(11);
      const again = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(applyDepsOf(s, trx, time), s.ctx, again, s.fake)).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
      const loop = await loopOf(trx, p.loopId);
      expect(loop.follow_ups_sent).toBe(1);
      expect(loop.last_follow_up_at?.getTime()).toBe(time.getTime());
    });
  });

  test("no copy in Sent: the recovery ends outcome_unknown, no second mail, the loop is not counted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const afterSend = () => {
        throw new Error("crash");
      };
      const first = await claimOne(trx, s, p.sendId, NOW);
      await expect(applySend(applyDepsOf(s, trx, NOW, { afterSend }), s.ctx, first, s.fake)).rejects.toThrow("crash");
      const time = at(11);
      const again = await claimOne(trx, s, p.sendId, time);
      expect(await applySend(applyDepsOf(s, trx, time, { sender: null }), s.ctx, again, s.fake)).toEqual({
        kind: "failed",
        reason: "outcome_unknown",
      });
      expect(s.sender.sent).toHaveLength(1);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(0);
    });
  });
});

describe("T9 the Sent copy of a follow-up is the system's own mail", () => {
  test("sentOriginOf: a started or applied loop send, and its draft, are system; a waiting one is a user draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const done = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });
      const waiting = await followUp(trx, s, { draftStatus: "applied", sendStatus: "awaiting_approval" });
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, done.draftId)).toBe("system");
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, done.sendId)).toBe("system");
      expect(await sentOriginOf(trx, s.ctx, s.mailboxId, waiting.draftId)).toBe("draft");
      // The header of a Sent copy names the draft: it is an own action of this mailbox only.
      expect(await isOwnActionId(trx, s.ctx, s.mailboxId, done.draftId)).toBe(true);
      // Another mailbox, another organization: null.
      const other = await createOrgWithMailbox(trx);
      expect(await sentOriginOf(trx, { orgId: other.orgId }, other.mailboxId, done.draftId)).toBeNull();
      expect(await sentOriginOf(trx, s.ctx, other.mailboxId, done.draftId)).toBeNull();
      expect(await isOwnActionId(trx, s.ctx, other.mailboxId, done.draftId)).toBe(false);
      expect(await isOwnActionId(trx, { orgId: other.orgId }, s.mailboxId, done.draftId)).toBe(false);
    });
  });

  test("the Sent pass reads the copy: a system row with the action id, headers only, no analysis row", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const s: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const done = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });
      put(org, 1, new Date(NOW.getTime() - HOUR_MS), { headers: { "X-EA-Action-Id": done.draftId } });
      const result = await syncSentHeaders(sentDepsOf(trx, org), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", stored: 1, system: 1 });
      const rows = await trx
        .selectFrom("sent_emails")
        .select(["origin", "content", "action_id", "body_text"])
        .where("org_id", "=", org.ctx.orgId)
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      // The loop's own sent mail is a seeded row too; the pass added the one with the action id.
      const copy = rows.find((entry) => entry.action_id === done.draftId);
      expect(copy).toMatchObject({ origin: "system", content: "headers_only", body_text: null });
      const analyses = await trx
        .selectFrom("sent_analyses")
        .select("sent_email_id")
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(analyses).toEqual([]);
    });
  });
});

describe("T10 the switch off ends a waiting follow-up", () => {
  test("setSentSync off: the loops close, a waiting send and an approved send expire with loop_closed", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const s: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const waiting = await followUp(trx, s, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      const approved = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const sent = await followUp(trx, s, { draftStatus: "applied", sendStatus: "applied" });

      await setSentSync(trx, s.ctx, s.mailboxId, { enabled: false, actor: "user-1", at: NOW }, sentSwitchHooks);

      for (const item of [waiting, approved]) {
        expect(await row(trx, item.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
        expect((await loopOf(trx, item.loopId)).status).toBe("closed");
      }
      expect((await row(trx, waiting.draftId)).status).toBe("expired");
      // A send that went out stays as it is.
      expect((await row(trx, sent.sendId)).status).toBe("applied");
      // An applied draft copy gets its reverse row (UIDPLUS): the mailbox of `newOrg` has the capability.
      const reverses = await trx
        .selectFrom("actions")
        .select("id")
        .where("reverses_action_id", "=", approved.draftId)
        .execute();
      expect(reverses).toHaveLength(1);
    });
  });
});

describe("T10b the switch off of one mailbox leaves the follow-ups of another mailbox of the organization", () => {
  test("mailbox B keeps its waiting and its approved follow-up, and its loop stays open", async () => {
    configureFeatures({ off: [] });
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const a: Setup = {
        ctx: org.ctx,
        userId: org.userId,
        mailboxId: org.mailboxId,
        address: "me@corp.test",
        fake: createFakeMailProvider(),
        sender: createFakeMailSender(),
        folderMap: {},
      };
      const waitingA = await followUp(trx, a, { draftStatus: "ready", sendStatus: "awaiting_approval" });
      const approvedA = await followUp(trx, a, { draftStatus: "applied", sendStatus: "approved" });
      const waitingB = await followUp(trx, a, {
        mailboxId: sibling.mailboxId,
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
      });
      const approvedB = await followUp(trx, a, {
        mailboxId: sibling.mailboxId,
        draftStatus: "applied",
        sendStatus: "approved",
      });

      await setSentSync(trx, a.ctx, a.mailboxId, { enabled: false, actor: "user-1", at: NOW }, sentSwitchHooks);

      for (const item of [waitingA, approvedA]) {
        expect(await row(trx, item.sendId)).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      }
      expect((await row(trx, waitingB.sendId)).status).toBe("awaiting_approval");
      expect((await row(trx, approvedB.sendId)).status).toBe("approved");
      expect((await row(trx, waitingB.draftId)).status).toBe("ready");
      expect((await row(trx, approvedB.draftId)).status).toBe("applied");
      expect((await loopOf(trx, waitingB.loopId)).status).toBe("open");
      expect((await loopOf(trx, approvedB.loopId)).status).toBe("open");
    });
  });
});

describe("the recipients come from the loop only, and the scope covers the Cc", () => {
  test("a follow-up to an address that the loop does not hold is never drafted or sent", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { to: [MARKERS.anna], cc: [] });
      // The draft payload names a stranger.
      await trx
        .updateTable("actions")
        .set({
          payload: JSON.stringify({ ...p.draftPayload, to: ["stranger@x.test"] }),
        })
        .where("id", "=", p.draftId)
        .execute();
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect((await row(trx, p.draftId)).status).toBe("failed");
      expect((await row(trx, p.draftId)).status_reason).toBe("bad_payload");
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("a send that names an address of the loop that its draft does not name ends bad_payload before any SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      // The loop holds anna (To) and jan (Cc). The draft names anna only; the send names both.
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ ...p.draftPayload, cc: [] }) })
        .where("id", "=", p.draftId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a mail-kind draft and send on a loop ends bad_payload at the send, with no SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const draft = { kind: "clarification", to: [MARKERS.anna], question: "q", language: "en" };
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(draft) })
        .where("id", "=", p.draftId)
        .execute();
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "clarification", to: [MARKERS.anna] }) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a send that waits for its tap is never claimed, even with an approval stamp on the row", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "awaiting_approval" });
      await trx
        .updateTable("actions")
        .set({ approved_at: at(-1), approved_by: s.userId, approved_via: "telegram" })
        .where("id", "=", p.sendId)
        .execute();
      // The claim itself refuses it: the later guard of `markApplying` is not the only one.
      const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
        now: NOW,
        limit: 20,
        staleBefore: new Date(NOW.getTime() - 10 * MINUTE_MS),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
      });
      expect(claimed.map((entry) => entry.id)).toEqual([]);
      await committerOf(trx, s, { now: NOW }).run();
      await committerOf(trx, s, { now: at(5) }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("a send of another kind for a follow-up draft ends bad_payload before any SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      // The send names the loop, so only its kind is wrong: the follow-up counters would never move.
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: [MARKERS.anna], loop_id: p.loopId }) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a loop send with a mail-kind payload, and a follow-up on a mail, are bad payloads", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s);
      await trx
        .updateTable("actions")
        .set({
          payload: JSON.stringify({
            kind: "clarification",
            to: [MARKERS.anna],
            question: "q",
            language: "en",
          }),
        })
        .where("id", "=", p.draftId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(await draftsCount(s)).toBe(0);
      expect(await row(trx, p.draftId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("an approved send to an address outside the loop ends bad_payload even when its draft is applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const stranger = { ...p.draftPayload, to: ["stranger@x.test"], cc: [] };
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(stranger) })
        .where("id", "=", p.draftId)
        .execute();
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(sendPayloadFor(stranger)) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("SEND_SCOPE self: a payload with a Cc that is not a list is never claimed and does not break the claim", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "follow_up", to: [MARKERS.anna], cc: MARKERS.jan, loop_id: p.loopId }) })
        .where("id", "=", p.sendId)
        .execute();
      const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
        now: NOW,
        limit: 20,
        staleBefore: new Date(NOW.getTime() - 10 * MINUTE_MS),
        filter: { mailbox: { kind: "all" }, send: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } },
      });
      expect(claimed.map((entry) => entry.id)).toEqual([]);
    });
  });

  test("the held reason of a send names the scope when a Cc is outside the list", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        sendStatus: "approved",
        approved: { userId: s.userId, at: at(-1) },
        to: MARKERS.anna,
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: [MARKERS.anna], cc: [MARKERS.jan] }) })
        .where("id", "=", mail.sendId)
        .execute();
      const only: HeldReasonDeps = { db: trx, sendScope: { kind: "self", addresses: [MARKERS.anna] } };
      expect(await heldReason(only, s.ctx, mail.sendId)).toBe("scope");
      const both: HeldReasonDeps = { db: trx, sendScope: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } };
      expect(await heldReason(both, s.ctx, mail.sendId)).toBeUndefined();
    });
  });

  test("SEND_SCOPE self: a Cc outside the list holds the follow-up; with every address listed it goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const held = committerOf(trx, s, { now: NOW }, { sendScope: { kind: "self", addresses: [MARKERS.anna] } });
      await held.run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });

      const open = committerOf(
        trx,
        s,
        { now: at(2) },
        { sendScope: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } }
      );
      await open.run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });
});

describe("onFollowUpSent", () => {
  test("a third count never raises the CHECK: the mail has gone out, the commit must hold", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s, { loop: { follow_ups_sent: 2 } });
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: p.loopId,
        sendId: p.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, p.loopId)).follow_ups_sent).toBe(2);
    });
  });

  test("a short wait setting never makes the next follow-up due before 3 working days", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 1 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      expect((await getMailboxSettings(trx, s.ctx, s.mailboxId))?.loop_wait_days).toBe(1);
      const p = await followUp(trx, s);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: p.loopId,
        sendId: p.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, p.loopId)).due_at.toISOString()).toBe("2026-11-25T16:00:00.000Z");
      // A long setting wins: 5 working days after Friday 20 Nov is Friday 27 Nov.
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 5 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const q = await followUp(trx, s);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: q.loopId,
        sendId: q.sendId,
        messageId: "<g@x.test>",
        at: NOW,
      });
      expect((await loopOf(trx, q.loopId)).due_at.toISOString()).toBe("2026-11-27T16:00:00.000Z");
    });
  });

  test("a closed loop gets the counters and keeps its due date; another organization's loop is not touched", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await createOrgWithMailbox(trx);
      const closed = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-5) } });
      const foreign = await followUp(
        trx,
        { ...s, ctx: { orgId: other.orgId }, mailboxId: other.mailboxId, userId: other.userId },
        {}
      );
      const before = await loopOf(trx, closed.loopId);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: closed.loopId,
        sendId: closed.sendId,
        messageId: "<f@x.test>",
        at: NOW,
      });
      const after = await loopOf(trx, closed.loopId);
      expect(after.follow_ups_sent).toBe(1);
      expect(after.due_at.getTime()).toBe(before.due_at.getTime());
      expect(after.message_id).toBe(before.message_id);
      // A hook call with the context of the wrong organization finds no loop.
      const foreignBefore = await loopOf(trx, foreign.loopId);
      await loopHooks().onFollowUpSent(trx, s.ctx, {
        loopId: foreign.loopId,
        sendId: foreign.sendId,
        messageId: "<g@x.test>",
        at: NOW,
      });
      expect(await loopOf(trx, foreign.loopId)).toEqual(foreignBefore);
      expect(await loopHooks().isOpen(trx, s.ctx, foreign.loopId)).toBe(false);
      expect(await loopHooks().anchorOf(trx, s.ctx, foreign.loopId)).toBeUndefined();
    });
  });

  test("anchorOf gives the thread, the copied recipients and the stored text of the opening mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await followUp(trx, s);
      const anchor = await loopHooks().anchorOf(trx, s.ctx, p.loopId);
      expect(anchor).toMatchObject({
        mailboxId: s.mailboxId,
        messageId: "<own-1@x.test>",
        referencesIds: ["<root@x.test>"],
        to: [MARKERS.anna],
        cc: [MARKERS.jan],
        language: "en",
        quote: MARKERS.quote,
      });
      // After retention the text is gone: no quote.
      await trx.updateTable("sent_emails").set({ content: "gone", body_text: null }).execute();
      expect((await loopHooks().anchorOf(trx, s.ctx, p.loopId))?.quote).toBeNull();
    });
  });
});

describe("logs", () => {
  test("a follow-up run writes no address, subject or quote into a log line", async () => {
    const capture = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const s = await prepare(trx);
        const sent = await followUp(trx, s);
        const closed = await followUp(trx, s, { loop: { status: "closed", close_reason: "done", closed_at: at(-5) } });
        const clock = { now: NOW };
        const committer = committerOf(trx, s, clock);
        await committer.run();
        await tap(trx, s, sent.sendId);
        await tap(trx, s, closed.sendId);
        clock.now = at(5);
        await committer.run();
        expect(s.sender.sent).toHaveLength(1);
      });
      const lines = capture.lines.filter((line) => line.includes('"module":"actions"'));
      expect(lines.length).toBeGreaterThan(0);
      expect(
        logProblems(capture.lines, [MARKERS.anna, MARKERS.jan, MARKERS.ewa, MARKERS.subject, MARKERS.quote])
      ).toEqual([]);
    } finally {
      capture.stop();
    }
  });
});
