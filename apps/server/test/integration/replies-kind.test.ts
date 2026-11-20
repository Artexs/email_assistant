import { randomBytes, randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  createPlanned,
  editApproval,
  getSend,
  noApprovalHooks,
  noDelegationHooks,
  type ApplyDeps,
  type ApprovalDeps,
  type ClaimedAction,
  type SendLimitHit,
} from "../../src/modules/actions";
import { approvalViewFor } from "../../src/modules/channels/notices/approval";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { matchSubject } from "../../src/modules/privacy";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, insertTriaged, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback, TEST_CREDENTIALS_KEY } from "./helpers";
import { putDraftCopy } from "./reply-fixtures";

// The draft kind `reply` through the actions module. The payloads are built by hand: nothing makes a reply yet.
// Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const CREATED = new Date(NOW.getTime() - HOUR_MS);
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const TO = "jan@x.test";
const CC = "c@z.test";

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
  await pauseOtherMailboxes(trx);
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

function depsOf(s: Setup, conn: Db | Transaction<DB>, hits: SendLimitHit[] = []): ApplyDeps {
  const folders = createFolderResolver(
    { db: conn, now: () => NOW, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: conn,
    now: () => NOW,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: s.sender,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
    onSendLimited: (_ctx, hit) => {
      hits.push(hit);
    },
  };
}

const claimAll = (conn: Db | Transaction<DB>, s: Setup, send: Parameters<typeof claimActions>[3]["filter"]["send"]) =>
  claimActions(conn, s.ctx, s.mailboxId, {
    now: NOW,
    limit: 20,
    staleBefore: new Date(NOW.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send },
  });

function pick(claimed: ClaimedAction[], id: string): ClaimedAction {
  const action = claimed.find((row) => row.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

// An approved reply send with an applied draft copy, ready to be claimed. The original mail has a thread and a sender name.
async function approvedReply(
  trx: Transaction<DB>,
  s: Setup,
  opts: { to?: string; cc?: string[]; sendCc?: string[]; fromName?: string } = {}
) {
  const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    kind: "reply",
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: s.userId, at: at(-1) },
    to: opts.to ?? TO,
    from: opts.to ?? TO,
    subject: "Offer",
    messageId: "<orig@x.test>",
    referencesHeader: "<root@x.test>",
    bodyText: "Please send the offer.",
    cc: opts.cc ?? [],
    ...(opts.sendCc === undefined ? {} : { sendCc: opts.sendCc }),
  });
  await putDraftCopy(trx, s, p, NOW);
  if (opts.fromName !== undefined) {
    await trx
      .insertInto("email_headers")
      .values({
        email_id: p.emailId,
        org_id: s.ctx.orgId,
        from_name: opts.fromName,
        parts_known: true,
        captured_at: NOW,
      })
      .execute();
  }
  return p;
}

async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function countedSends(trx: Transaction<DB>, s: Setup, to: string, hoursAgo: number[]): Promise<void> {
  for (const hours of hoursAgo) {
    const sent = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
      createdAt: CREATED,
      sendStatus: "applied",
      approved: { userId: s.userId, at: at(-120) },
      to,
    });
    await trx
      .updateTable("actions")
      .set({ send_started_at: at(-hours * 60) })
      .where("id", "=", sent.sendId)
      .execute();
  }
}

describe("a reply send through the committer (F115 stage 04)", () => {
  test("7: a reply with one Cc: two recipients in the envelope, a Cc header and the thread headers in the mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await approvedReply(trx, s, { cc: [CC], fromName: "Jan Kowalski" });
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      expect(await applySend(depsOf(s, trx), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });

      expect(s.sender.sent).toHaveLength(1);
      expect(s.sender.sent[0]?.envelope.to).toEqual([TO, CC]);
      const raw = s.sender.sent[0]?.raw.toString("utf8") ?? "";
      expect(raw).toContain(`To: ${TO}`);
      expect(raw).toContain(`Cc: ${CC}`);
      expect(raw).toContain("In-Reply-To: <orig@x.test>");
      expect(raw).toContain("References: <root@x.test> <orig@x.test>");
      expect(raw).toContain("Subject: Re: Offer");
      // The quote line carries the display name of the sender, read from the stored headers.
      expect(raw).toContain("Jan Kowalski wrote:");
      expect(raw).toContain("> Please send the offer.");
    });
  });

  test("4: Cc c@z with 5 sends to c@z today: held send_limit:recipient_day, no SMTP", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await countedSends(trx, s, CC, [10, 8, 6, 4, 2]);
      const p = await approvedReply(trx, s, { cc: [CC] });
      const hits: SendLimitHit[] = [];
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      expect(await applySend(depsOf(s, trx, hits), s.ctx, claimed, s.fake)).toEqual({ kind: "retry", soft: false });

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", last_error: "send_limit:recipient_day" });
      expect(hits).toHaveLength(1);
    });
  });

  test("4b: the same Cc with 4 sends today: the reply goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await countedSends(trx, s, CC, [10, 8, 6, 4]);
      const p = await approvedReply(trx, s, { cc: [CC] });
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      expect(await applySend(depsOf(s, trx), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("5: SEND_SCOPE self: a To in the list and a Cc outside it is never claimed; with both listed it is sent", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addCredentials(trx, s);
      // A reply goes out only while the org flag `reply_drafts` is on: the committer run below needs it.
      await setOrgFeature(trx, s.ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
      const p = await approvedReply(trx, s, { cc: [CC] });

      const only = await claimAll(trx, s, { kind: "self", addresses: [TO] });
      expect(only.map((entry) => entry.id)).not.toContain(p.sendId);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });

      const job = (addresses: string[]) =>
        createCommitterJob({
          db: trx,
          secrets,
          openProvider: async () => s.fake,
          openSender: async () => {
            s.sender.closed = false;
            return s.sender;
          },
          compose: composeMessage,
          scope: { kind: "all" },
          sendScope: { kind: "self", addresses },
          now: () => NOW,
        });
      await job([TO]).run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("approved");

      await job([TO, CC]).run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });

  test("8: a send whose Cc differs from its draft: bad_payload, no SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await approvedReply(trx, s, { cc: [CC], sendCc: ["other@z.test"] });
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      expect(await applySend(depsOf(s, trx), s.ctx, claimed, s.fake)).toMatchObject({ kind: "failed" });

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("8b: a send with a Cc that its draft does not have, and a send with no Cc for a draft with one: bad_payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const extra = await approvedReply(trx, s, { cc: [], sendCc: [CC] });
      const missing = await approvedReply(trx, s, { to: "ewa@x.test", cc: [CC], sendCc: [] });
      const claimed = await claimAll(trx, s, { kind: "all" });

      await applySend(depsOf(s, trx), s.ctx, pick(claimed, extra.sendId), s.fake);
      await applySend(depsOf(s, trx), s.ctx, pick(claimed, missing.sendId), s.fake);

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, extra.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
      expect(await row(trx, missing.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("8c: a send that names another To than its draft: bad_payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await approvedReply(trx, s);
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "reply", to: ["stranger@x.test"], cc: [] }) })
        .where("id", "=", p.sendId)
        .execute();
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      await applySend(depsOf(s, trx), s.ctx, claimed, s.fake);

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("8d: the same addresses in another order and letter case are the same recipients: the reply goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await approvedReply(trx, s, { cc: [CC, "d@z.test"], sendCc: ["D@Z.test", CC.toUpperCase()] });
      const claimed = pick(await claimAll(trx, s, { kind: "all" }), p.sendId);

      expect(await applySend(depsOf(s, trx), s.ctx, claimed, s.fake)).toEqual({ kind: "applied" });
      expect(s.sender.sent).toHaveLength(1);
    });
  });

  test("8e: a send of another kind for a reply draft, and a reply send for another draft kind: bad_payload", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const wrongSend = await approvedReply(trx, s);
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "clarification", to: [TO] }) })
        .where("id", "=", wrongSend.sendId)
        .execute();
      const wrongDraft = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        kind: "clarification",
        createdAt: CREATED,
        draftStatus: "applied",
        draftProviderResult: { uid: 1, folder: "Drafts" },
        sendStatus: "approved",
        approved: { userId: s.userId, at: at(-1) },
        to: "ewa@x.test",
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "reply", to: ["ewa@x.test"], cc: [] }) })
        .where("id", "=", wrongDraft.sendId)
        .execute();
      const claimed = await claimAll(trx, s, { kind: "all" });

      await applySend(depsOf(s, trx), s.ctx, pick(claimed, wrongSend.sendId), s.fake);
      await applySend(depsOf(s, trx), s.ctx, pick(claimed, wrongDraft.sendId), s.fake);

      expect(s.sender.calls).toEqual([]);
      expect(await row(trx, wrongSend.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
      expect(await row(trx, wrongDraft.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("9: a reply that waits for the tap is never sent; its draft copy is made and nothing else", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      await addCredentials(trx, s);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        kind: "reply",
        createdAt: CREATED,
        draftStatus: "ready",
        to: TO,
        cc: [CC],
        from: TO,
        subject: "Offer",
        messageId: "<orig@x.test>",
        bodyText: "Please send the offer.",
      });
      let clock = NOW;
      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => {
          s.sender.closed = false;
          return s.sender;
        },
        compose: composeMessage,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => clock,
      });

      await job.run();
      clock = at(30);
      await job.run();

      expect((await row(trx, p.draftId)).status).toBe("applied");
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval", approved_at: null });
      expect(s.sender.calls).toEqual([]);
      expect(await s.fake.searchSinceIn("Drafts", new Date(CREATED.getTime() - HOUR_MS))).toHaveLength(1);
      expect(await s.fake.searchSinceIn("Sent", new Date(CREATED.getTime() - HOUR_MS))).toHaveLength(0);
    });
  });

  test("9b: the card of a reply shows the quote with the display name of the sender and every Cc", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await approvedReply(trx, s, { cc: [CC], fromName: "Jan Kowalski" });
      const send = await getSend(trx, s.ctx, p.sendId);
      if (send === undefined) throw new Error("no send");
      const { view } = await approvalViewFor(trx, s.ctx, send);
      expect(view.kind).toBe("reply");
      expect(view.to).toEqual([TO]);
      expect(view.cc).toEqual([CC]);
      expect(view.quote?.text).toContain("Jan Kowalski wrote:");
      expect(view.subject).toBe("Re: Offer");
    });
  });
});

describe("editApproval of a reply (reply drafts)", () => {
  const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
  const edit = (trx: Transaction<DB>, s: Setup, sendId: string) =>
    editApproval(
      {
        db: trx,
        hooks: delegationHooks({ db }),
        approvalHooks: noApprovalHooks,
        uidplus: async () => true,
      } as ApprovalDeps,
      s.ctx,
      sendId,
      { userId: s.userId, via: "web", now: NOW, subject: "Re: Offer", body: "My own text." }
    );

  async function withSwitches(trx: Transaction<DB>, s: Setup, switches: Record<string, boolean>) {
    await insertDefaultSettings(trx, s.ctx, s.mailboxId);
    await updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
    // `reply_drafts` is no key of the mail tool switches: the stored JSON is written as the settings service writes it.
    await trx
      .updateTable("mailbox_settings")
      .set({ tool_switches: JSON.stringify({ ...SWITCHES, ...switches }) })
      .where("mailbox_id", "=", s.mailboxId)
      .execute();
  }

  async function waitingReply(trx: Transaction<DB>, s: Setup, kind: "reply" | "delegation") {
    return insertDraftAndSend(trx, s.ctx, s.mailboxId, {
      kind,
      createdAt: CREATED,
      draftStatus: "ready",
      to: TO,
      from: TO,
      subject: "Offer",
      messageId: `<orig-${randomUUID()}@x.test>`,
      bodyText: "Please send the offer.",
    });
  }

  test("3: create_draft off and reply_drafts on: the edit of a reply is made", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await withSwitches(trx, s, { create_draft: false, reply_drafts: true });
      const p = await waitingReply(trx, s, "reply");

      expect(await edit(trx, s, p.sendId)).toMatchObject({ kind: "edited", version: 2 });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "superseded" });
    });
  });

  test("3b: reply_drafts off (create_draft on): drafts_off, nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await withSwitches(trx, s, { create_draft: true, reply_drafts: false });
      const p = await waitingReply(trx, s, "reply");

      expect(await edit(trx, s, p.sendId)).toEqual({ kind: "drafts_off" });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("3c: the other kinds keep create_draft as their gate, whatever reply_drafts says", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await withSwitches(trx, s, { create_draft: false, reply_drafts: true });
      const p = await waitingReply(trx, s, "delegation");
      expect(await edit(trx, s, p.sendId)).toEqual({ kind: "drafts_off" });
    });
  });

  test("3d: shadow mode refuses a reply edit even with reply_drafts on", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await withSwitches(trx, s, { reply_drafts: true });
      await trx.updateTable("mailbox_settings").set({ mode: "shadow" }).where("mailbox_id", "=", s.mailboxId).execute();
      const p = await waitingReply(trx, s, "reply");
      expect(await edit(trx, s, p.sendId)).toEqual({ kind: "drafts_off" });
    });
  });

  test("3e: the edited version keeps the recipients and the folder of the reply and sets its text", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await withSwitches(trx, s, { reply_drafts: true });
      const p = await waitingReply(trx, s, "reply");
      const result = await edit(trx, s, p.sendId);
      if (result.kind !== "edited") throw new Error("not edited");
      const newest = await row(trx, result.sendId);
      expect(newest.payload).toMatchObject({ kind: "reply", to: [TO], cc: [] });
      const draft = await trx
        .selectFrom("actions")
        .select("payload")
        .where("supersedes_action_id", "=", p.draftId)
        .executeTakeFirstOrThrow();
      expect(draft.payload).toMatchObject({
        kind: "reply",
        version: 2,
        folder: "INBOX",
        body_text: "My own text.",
        subject_text: "Re: Offer",
      });
    });
  });
});

describe("the writer of a reply pair (reply drafts)", () => {
  async function mailOf(trx: Transaction<DB>, s: Setup): Promise<string> {
    return insertTriaged(trx, s.ctx, s.mailboxId, { category: "needs_reply", createdAt: CREATED, from: TO });
  }
  const payload = (over: Record<string, unknown> = {}) => ({
    kind: "reply",
    to: [TO],
    cc: [CC],
    language: "en",
    body: "Thanks.",
    request_id: randomUUID(),
    folder: "INBOX",
    recipients: "all",
    ...over,
  });
  const pair = (
    draft: Record<string, unknown>,
    send: Record<string, unknown> = { kind: "reply", to: [TO], cc: [CC] }
  ) => [
    { type: "create_draft" as const, payload: draft, status: "ready" as const, idempotencyKey: "k:create_draft" },
    {
      type: "send" as const,
      payload: send,
      status: "awaiting_approval" as const,
      idempotencyKey: "k:send",
      dependsOn: "create_draft" as const,
    },
  ];
  const write = async (trx: Transaction<DB>, s: Setup, items: ReturnType<typeof pair>) => {
    const emailId = await mailOf(trx, s);
    const keyed = items.map((item) => ({ ...item, idempotencyKey: item.idempotencyKey.replace("k:", `${emailId}:`) }));
    return createPlanned(trx, s.ctx, emailId, keyed);
  };

  test("2: a valid pair is written", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      expect(await write(trx, s, pair(payload()))).toHaveLength(2);
    });
  });

  test("2b: a Cc equal to To, in any letter case, is refused", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await expect(
        write(trx, s, pair(payload({ cc: [TO.toUpperCase()] }), { kind: "reply", to: [TO], cc: [] }))
      ).rejects.toThrow("cc_is_to");
    });
  });

  test("2c: an own mailbox in Cc is refused; so is a Cc that names an address twice", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await expect(
        write(trx, s, pair(payload({ cc: [s.address] }), { kind: "reply", to: [TO], cc: [s.address] }))
      ).rejects.toThrow("cc_own_mailbox");
      await expect(
        write(trx, s, pair(payload({ cc: [CC, CC.toUpperCase()] }), { kind: "reply", to: [TO], cc: [CC, CC] }))
      ).rejects.toThrow("cc_duplicate");
    });
  });

  test("2d: 11 Cc fail the schema in the writer", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const cc = Array.from({ length: 11 }, (_, i) => `c${i}@z.test`);
      await expect(write(trx, s, pair(payload({ cc }), { kind: "reply", to: [TO], cc }))).rejects.toThrow("invalid");
    });
  });

  test("2e: a send that names other recipients than its draft in the same call is refused", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await expect(write(trx, s, pair(payload(), { kind: "reply", to: [TO], cc: [] }))).rejects.toThrow("different");
      await expect(write(trx, s, pair(payload(), { kind: "reply", to: ["x@y.test"], cc: [CC] }))).rejects.toThrow(
        "different"
      );
    });
  });

  test("2f: the error text holds no address", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const error = await write(trx, s, pair(payload({ cc: [TO] }), { kind: "reply", to: [TO], cc: [TO] })).catch(
        (caught: unknown) => caught
      );
      expect(String(error)).not.toContain("@");
    });
  });

  test("2g: a reply hangs on a mail: a loop anchor is refused", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { createPlannedForLoop } = await import("../../src/modules/actions");
      await expect(createPlannedForLoop(trx, s.ctx, randomUUID(), pair(payload()))).rejects.toThrow("mail");
    });
  });
});

describe("the data request finds a reply by its Cc (reply drafts)", () => {
  test("6: a find for c@z returns the reply draft and its send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const person = `c-${randomUUID().slice(0, 8)}@z.test`;
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        kind: "reply",
        to: `other-${randomUUID().slice(0, 8)}@x.test`,
        cc: [person],
        createdAt: CREATED,
      });
      const match = await matchSubject(trx, s.ctx.orgId, person, TEST_CREDENTIALS_KEY);
      expect([...(match.mentions["actions.payload"] ?? [])].sort()).toEqual([p.draftId, p.sendId].sort());
      expect(match.openActions).toContain(p.sendId);
    });
  });
});
