import { randomBytes, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  applySend,
  approve,
  claimActions,
  closeSend,
  createCommitterJob,
  createExpiryJob,
  createFolderResolver,
  editApproval,
  expireUnseenApprovals,
  noApprovalHooks,
  noDelegationHooks,
  replaceApproval,
  type ApplyDeps,
  type ApprovalDeps,
  type ApprovalHooks,
  type ClaimedAction,
  type CloseSendDeps,
} from "../../src/modules/actions";
import { cardEditHooks } from "../../src/modules/channels";
import { listApprovals } from "../../src/modules/channels/approvals-read";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";
import { putDraftCopy } from "./reply-fixtures";

// The lifetime of a reply send, the gap rule, the flag rule, `replaceApproval` and `closeSend`.
// Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const TO = "jan@x.test";
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

interface World {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

// `flag`: the org flag `reply_drafts` (on by default here). The mailbox is in assist mode with the reply switch on.
async function world(trx: Transaction<DB>, opts: { flag?: boolean } = {}): Promise<World> {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
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
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await updateMailboxSettings(trx, ctx, box.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  await trx
    .updateTable("mailbox_settings")
    .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: true }) })
    .where("mailbox_id", "=", box.mailboxId)
    .execute();
  if (opts.flag !== false) {
    await setOrgFeature(trx, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
  }
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return {
    ctx,
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    sender: createFakeMailSender(),
    folderMap,
  };
}

async function addCredentials(trx: Transaction<DB>, w: World): Promise<void> {
  const secret = secrets.encrypt("pw", `mailbox:${w.mailboxId}`);
  await insertCredentials(trx, w.ctx, {
    mailboxId: w.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
}

type Pair = Parameters<typeof insertDraftAndSend>[3];

// A waiting reply send (draft `applied`, as the approve needs) made `createdAgo` ago, with the fields of `opts`.
async function reply(trx: Transaction<DB>, w: World, createdAgo: number, opts: Pair = {}) {
  return insertDraftAndSend(trx, w.ctx, w.mailboxId, {
    kind: "reply",
    createdAt: ago(createdAgo),
    draftProviderResult: { folder: "Drafts", uid: 7 },
    to: TO,
    from: TO,
    subject: "Offer",
    messageId: `<orig-${randomUUID()}@x.test>`,
    bodyText: "Please send the offer.",
    ...opts,
  });
}

const approvalDeps = (trx: Transaction<DB>, hooks: ApprovalHooks = noApprovalHooks): ApprovalDeps => ({
  db: trx,
  hooks: noDelegationHooks,
  approvalHooks: hooks,
  uidplus: async () => true,
});

const tap = (trx: Transaction<DB>, w: World, sendId: string, now: Date = NOW) =>
  approve(approvalDeps(trx), w.ctx, sendId, { userId: w.userId, via: "telegram", now });

const expiryJob = (trx: Transaction<DB>, now: Date = NOW) =>
  createExpiryJob({ db: trx, now: () => now, hooks: noDelegationHooks, uidplus: async () => true });

async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function auditRows(conn: Db | Transaction<DB>, actionId: string, event: string) {
  return conn
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .execute();
}

describe("step 1: the time limit per kind", () => {
  test("1a: a reply never notified is kept at 6 d 23 h and expires as timeout at 7 d 1 min", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const kept = await reply(trx, w, 6 * DAY_MS + 23 * HOUR_MS);
      const old = await reply(trx, w, 7 * DAY_MS + MINUTE_MS, { to: "ewa@x.test", from: "ewa@x.test" });

      await expiryJob(trx).run();

      expect(await row(trx, kept.sendId)).toMatchObject({ status: "awaiting_approval", status_reason: null });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
      expect(await auditRows(trx, old.sendId, "action.expired")).toHaveLength(1);
    });
  });

  test("1b: a reply that an owner was told about 49 h ago keeps its 7 days (the 48 h rule skips it)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(49 * HOUR_MS), requestSent: true });

      await expiryJob(trx).run();

      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("1c: a reply with a notice that nobody saw is not closed as not_seen, at the job or at a resume", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(60 * HOUR_MS) });

      await expiryJob(trx).run();
      const closed = await expireUnseenApprovals(trx, w.ctx, {
        resumedAt: NOW,
        actor: "system",
        hooks: noDelegationHooks,
        uidplus: async () => true,
      });

      expect(closed).toBe(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("1d: a delegation send notified 49 h ago expires as timeout (the old rule)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(DAY_MS),
        notifiedAt: ago(49 * HOUR_MS),
        requestSent: true,
      });

      await expiryJob(trx).run();

      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
    });
  });

  test("1e: a held (approved) reply keeps the 48 h rule from the tap", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const kept = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(47 * HOUR_MS) },
      });
      const old = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(49 * HOUR_MS) },
        to: "ewa@x.test",
        from: "ewa@x.test",
      });

      await expiryJob(trx).run();

      expect(await row(trx, kept.sendId)).toMatchObject({ status: "approved" });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "held_timeout" });
    });
  });

  test("1f: a tap on a reply at 7 d 1 min expires it; at 6 days it approves", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const old = await reply(trx, w, 7 * DAY_MS + MINUTE_MS);
      const fresh = await reply(trx, w, 6 * DAY_MS, { to: "ewa@x.test", from: "ewa@x.test" });

      expect(await tap(trx, w, old.sendId)).toEqual({ kind: "expired", byThisTap: true });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
      expect(await tap(trx, w, fresh.sendId)).toEqual({ kind: "approved" });
    });
  });

  test("1g: a tap on a reply notified 49 h ago still approves (a delegation send does not)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(49 * HOUR_MS) });
      const other = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(3 * DAY_MS),
        notifiedAt: ago(49 * HOUR_MS),
      });

      expect(await tap(trx, w, p.sendId)).toEqual({ kind: "approved" });
      expect(await tap(trx, w, other.sendId)).toEqual({ kind: "expired", byThisTap: true });
    });
  });

  test("1i: the approval list gives a held (approved) reply expiresAt = approved_at + 48 h", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const held = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(5 * HOUR_MS) },
      });

      const list = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, w.ctx, NOW);

      const item = list.items.find((entry) => entry.id === held.sendId);
      expect(item).toMatchObject({ state: "held" });
      expect(item?.expiresAt).toBe(new Date(ago(5 * HOUR_MS).getTime() + 2 * DAY_MS).toISOString());
    });
  });

  test("1h: the approval list gives a reply expiresAt = created_at + 7 d, notified or not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const plain = await reply(trx, w, 2 * DAY_MS);
      const told = await reply(trx, w, 3 * DAY_MS, { to: "ewa@x.test", from: "ewa@x.test", notifiedAt: ago(HOUR_MS) });
      const other = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(3 * DAY_MS),
        notifiedAt: ago(HOUR_MS),
      });

      const list = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, w.ctx, NOW);

      const expires = (id: string) => list.items.find((item) => item.id === id)?.expiresAt;
      expect(expires(plain.sendId)).toBe(new Date(ago(2 * DAY_MS).getTime() + 7 * DAY_MS).toISOString());
      expect(expires(told.sendId)).toBe(new Date(ago(3 * DAY_MS).getTime() + 7 * DAY_MS).toISOString());
      // The old rule for another kind: 48 h after the owner was told.
      expect(expires(other.sendId)).toBe(new Date(ago(HOUR_MS).getTime() + 2 * DAY_MS).toISOString());
    });
  });
});

describe("step 2: gaps and the flag", () => {
  test("2a: a reply with a gap is not approvable; the version without it is", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { replyBody: "Tak [[godzina]]" });

      expect(await tap(trx, w, p.sendId)).toEqual({ kind: "has_gaps" });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });

      const edited = await editApproval(approvalDeps(trx), w.ctx, p.sendId, {
        userId: w.userId,
        via: "web",
        now: NOW,
        subject: "Re: Offer",
        body: "Tak, 10:00",
      });
      if (edited.kind !== "edited") throw new Error(`edit gave ${edited.kind}`);
      // The new version holds its own draft: the test marks it applied, as the committer does in the product.
      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: NOW, provider_result: JSON.stringify({ folder: "Drafts", uid: 8 }) })
        .where("supersedes_action_id", "is not", null)
        .where("type", "=", "create_draft")
        .where("org_id", "=", w.ctx.orgId)
        .execute();

      expect(await tap(trx, w, edited.sendId)).toEqual({ kind: "approved" });
    });
  });

  test("2b: the edited text is the one that counts: a gap in body_text refuses, a clean body_text over a gap body approves", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const gapInEdit = await reply(trx, w, HOUR_MS, { replyBody: "Tak." });
      const cleanEdit = await reply(trx, w, HOUR_MS, {
        replyBody: "Tak [[godzina]]",
        to: "ewa@x.test",
        from: "ewa@x.test",
      });
      for (const [id, text] of [
        [gapInEdit.draftId, "Tak [[kiedy]]"],
        [cleanEdit.draftId, "Tak, 10:00"],
      ] as const) {
        await trx
          .updateTable("actions")
          .set({ payload: sql`payload || ${JSON.stringify({ body_text: text })}::jsonb` })
          .where("id", "=", id)
          .execute();
      }

      expect(await tap(trx, w, gapInEdit.sendId)).toEqual({ kind: "has_gaps" });
      expect(await tap(trx, w, cleanEdit.sendId)).toEqual({ kind: "approved" });
    });
  });

  test("2b2: a reply whose draft text cannot be read is not approved (the gap check cannot run)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS);
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "reply" }) })
        .where("id", "=", p.draftId)
        .execute();

      expect(await tap(trx, w, p.sendId)).toEqual({ kind: "draft_not_ready" });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("2c: flag off: approve answers feature_off and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { flag: false });
      const p = await reply(trx, w, HOUR_MS);

      expect(await tap(trx, w, p.sendId)).toEqual({ kind: "feature_off" });
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval", approved_at: null });
    });
  });

  test("2d: flag off: an approved reply is not claimed, a delegation send is; with the flag on both go out", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { flag: false });
      await addCredentials(trx, w);
      const heldReply = await reply(trx, w, HOUR_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
      });
      await putDraftCopy(trx, w, heldReply, NOW);
      const delegation = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        draftStatus: "applied",
        draftProviderResult: { folder: "Drafts", uid: 9 },
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
        createdAt: ago(HOUR_MS),
      });
      const job = () =>
        createCommitterJob({
          db: trx,
          secrets,
          openProvider: async () => w.fake,
          openSender: async () => {
            w.sender.closed = false;
            return w.sender;
          },
          compose: composeMessage,
          scope: { kind: "all" },
          sendScope: { kind: "all" },
          now: () => NOW,
        });

      await job().run();
      expect(await row(trx, heldReply.sendId)).toMatchObject({ status: "approved", locked_at: null });
      expect(await row(trx, delegation.sendId)).toMatchObject({ status: "applied" });
      expect(w.sender.sent).toHaveLength(1);

      await setOrgFeature(trx, w.ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
      await job().run();
      expect(await row(trx, heldReply.sendId)).toMatchObject({ status: "applied" });
      expect(w.sender.sent).toHaveLength(2);
    });
  });

  test("2e: a send of an old claim that the flag change finds in `applying` is not stopped (recovery sends nothing)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { flag: false });
      const p = await reply(trx, w, HOUR_MS, {
        sendStatus: "applying",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
      });
      const claimed = await claimActions(trx, w.ctx, w.mailboxId, {
        now: NOW,
        limit: 20,
        staleBefore: ago(10 * MINUTE_MS),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" }, replies: "off" },
      });
      expect(claimed.map((entry) => entry.id)).toContain(p.sendId);
    });
  });

  test("2f: the committer refuses a gap at the claim: failed / has_gaps, no SMTP", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, {
        draftStatus: "applied",
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
        replyBody: "Tak [[godzina]]",
      });
      const claimed = (
        await claimActions(trx, w.ctx, w.mailboxId, {
          now: NOW,
          limit: 20,
          staleBefore: ago(10 * MINUTE_MS),
          filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
        })
      ).find((entry) => entry.id === p.sendId) as ClaimedAction;
      const folders = createFolderResolver(
        { db: trx, now: () => NOW, provider: w.fake, mailboxId: w.mailboxId, folderMap: w.folderMap },
        w.ctx
      );
      const deps: ApplyDeps = {
        db: trx,
        now: () => NOW,
        mailboxId: w.mailboxId,
        folders,
        mailbox: { address: w.address, capabilities: { uidplus: true }, folderMap: w.folderMap },
        owner: { displayName: "Owner" },
        organization: { styleText: null, timezone: "Europe/Warsaw" },
        compose: composeMessage,
        sender: w.sender,
        hooks: noDelegationHooks,
        appendFolders: new Set(),
      };

      expect(await applySend(deps, w.ctx, claimed, w.fake)).toEqual({ kind: "failed", reason: "has_gaps" });

      expect(w.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "has_gaps" });
    });
  });

  test("2f2: the gap in an edited text (body_text) is refused at the claim too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, {
        draftStatus: "applied",
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
        replyBody: "Tak.",
      });
      await trx
        .updateTable("actions")
        .set({ payload: sql`payload || ${JSON.stringify({ body_text: "Tak [[kiedy]]" })}::jsonb` })
        .where("id", "=", p.draftId)
        .execute();
      const claimed = (
        await claimActions(trx, w.ctx, w.mailboxId, {
          now: NOW,
          limit: 20,
          staleBefore: ago(10 * MINUTE_MS),
          filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
        })
      ).find((entry) => entry.id === p.sendId) as ClaimedAction;
      const folders = createFolderResolver(
        { db: trx, now: () => NOW, provider: w.fake, mailboxId: w.mailboxId, folderMap: w.folderMap },
        w.ctx
      );
      const deps: ApplyDeps = {
        db: trx,
        now: () => NOW,
        mailboxId: w.mailboxId,
        folders,
        mailbox: { address: w.address, capabilities: { uidplus: true }, folderMap: w.folderMap },
        owner: { displayName: "Owner" },
        organization: { styleText: null, timezone: "Europe/Warsaw" },
        compose: composeMessage,
        sender: w.sender,
        hooks: noDelegationHooks,
        appendFolders: new Set(),
      };

      expect(await applySend(deps, w.ctx, claimed, w.fake)).toEqual({ kind: "failed", reason: "has_gaps" });

      expect(w.sender.calls).toEqual([]);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "has_gaps" });
    });
  });
});

const closeDeps = (): CloseSendDeps => ({
  hooks: noDelegationHooks,
  approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
  uidplus: async () => true,
});

describe("step 3: replaceApproval and closeSend", () => {
  test("3a: replaceApproval with a new cc makes version 2 with the cc; the old send is superseded", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });

      const result = await replaceApproval(trx, w.ctx, {
        sendId: p.sendId,
        userId: w.userId,
        via: "web",
        now: NOW,
        deps: approvalDeps(trx),
        payload: { cc: ["c@z.test"] },
      });

      if (result.kind !== "edited") throw new Error(`replace gave ${result.kind}`);
      expect(result.version).toBe(2);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "superseded" });
      expect((await row(trx, p.draftId)).status).not.toBe("ready");
      const draft = await row(trx, result.draftId);
      expect(draft).toMatchObject({ status: "ready", supersedes_action_id: p.draftId });
      expect(draft.payload).toMatchObject({ kind: "reply", version: 2, cc: ["c@z.test"], to: [TO] });
      const send = await row(trx, result.sendId);
      expect(send).toMatchObject({ status: "awaiting_approval", supersedes_action_id: p.sendId });
      expect(send.payload).toMatchObject({ kind: "reply", to: [TO], cc: ["c@z.test"] });
      expect(await auditRows(trx, result.sendId, "action.edited")).toHaveLength(1);
    });
  });

  test("3b: replaceApproval refuses an invalid recipient set: nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });

      await expect(
        replaceApproval(trx, w.ctx, {
          sendId: p.sendId,
          userId: w.userId,
          via: "web",
          now: NOW,
          deps: approvalDeps(trx),
          payload: { cc: Array.from({ length: 11 }, (_, i) => `c${i}@z.test`) },
        })
      ).rejects.toThrow("replaced draft payload is invalid");
    });
  });

  test("3c: replaceApproval with the reply switch off answers drafts_off; a closed send names its state", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });
      const input = {
        sendId: p.sendId,
        userId: w.userId,
        via: "web" as const,
        now: NOW,
        deps: approvalDeps(trx),
        payload: { cc: ["c@z.test"] },
      };
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: false }) })
        .where("mailbox_id", "=", w.mailboxId)
        .execute();
      expect(await replaceApproval(trx, w.ctx, input)).toEqual({ kind: "drafts_off" });
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: true }) })
        .where("mailbox_id", "=", w.mailboxId)
        .execute();
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", p.sendId).execute();
      expect(await replaceApproval(trx, w.ctx, input)).toEqual({ kind: "closed", state: "rejected" });
    });
  });

  test("3d: closeSend on an applying send answers busy, whatever claimed says", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, {
        sendStatus: "applying",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
      });
      for (const claimed of [false, true]) {
        const result = await closeSend(trx, w.ctx, {
          sendId: p.sendId,
          reason: "answered",
          notify: false,
          claimed,
          now: NOW,
          deps: closeDeps(),
        });
        expect(result).toEqual({ kind: "busy" });
      }
      expect((await row(trx, p.sendId)).status).toBe("applying");
    });
  });

  test("3e: closeSend on a locked approved row: busy when not claimed, closed when claimed; a stale lock closes", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const locked = await reply(trx, w, HOUR_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(5 * MINUTE_MS) },
        lockedAt: ago(MINUTE_MS),
      });
      const stale = await reply(trx, w, HOUR_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(30 * MINUTE_MS) },
        lockedAt: ago(20 * MINUTE_MS),
        to: "ewa@x.test",
        from: "ewa@x.test",
      });
      const close = (sendId: string, claimed: boolean) =>
        closeSend(trx, w.ctx, { sendId, reason: "draft_changed", notify: false, claimed, now: NOW, deps: closeDeps() });

      expect(await close(locked.sendId, false)).toEqual({ kind: "busy" });
      expect((await row(trx, locked.sendId)).status).toBe("approved");
      expect(await close(locked.sendId, true)).toEqual({ kind: "closed", sendId: locked.sendId });
      expect(await row(trx, locked.sendId)).toMatchObject({
        status: "expired",
        status_reason: "draft_changed",
        locked_at: null,
      });
      expect(await close(stale.sendId, false)).toEqual({ kind: "closed", sendId: stale.sendId });
    });
  });

  test("3f: closeSend of a sent-and-closed row answers not_open with its state and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { sendStatus: "rejected" });

      const result = await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "answered",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "not_open", state: "rejected" });
      expect(await auditRows(trx, p.sendId, "action.expired")).toHaveLength(0);
    });
  });

  test("3g: closeSend answered, notify false: expired / answered, draft closed, a card edit per sent card, one audit row, notice mark set", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });
      const cards = [501, 502];
      const owner2 = await trx
        .insertInto("users")
        .values({ email: `o2-${randomUUID()}@x.test`, display_name: "Two", locale: "en" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.insertInto("memberships").values({ org_id: w.ctx.orgId, user_id: owner2.id, role: "owner" }).execute();
      const users = [w.userId, owner2.id];
      for (const [index, messageId] of cards.entries()) {
        await trx
          .insertInto("outbox")
          .values({
            org_id: w.ctx.orgId,
            user_id: users[index] as string,
            kind: "approval",
            dedup_key: `approval:${p.sendId}`,
            email_id: p.emailId,
            text: `CARD-${messageId}`,
            buttons: JSON.stringify([]),
            status: "sent",
            next_attempt_at: ago(HOUR_MS),
            created_at: ago(HOUR_MS),
            sent_at: ago(HOUR_MS),
            external_message_id: messageId,
          })
          .execute();
      }

      const result = await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "answered",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "closed", sendId: p.sendId });
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: NOW,
      });
      // The draft is `applied` with UIDPLUS: a reverse row removes the copy.
      const reverse = await trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", p.draftId).execute();
      expect(reverse).toHaveLength(1);
      const edits = await trx
        .selectFrom("outbox")
        .select(["user_id", "dedup_key"])
        .where("org_id", "=", w.ctx.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(edits).toHaveLength(2);
      expect(edits.every((edit) => edit.dedup_key.endsWith(":expired"))).toBe(true);
      const audit = await auditRows(trx, p.sendId, "action.expired");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason_code: "answered" });
    });
  });

  test("3h: closeSend with notify true leaves the notice mark null", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "ready" });

      await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "newer_mail",
        notify: true,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "newer_mail",
        result_notified_at: null,
      });
      expect((await row(trx, p.draftId)).status).toBe("expired");
    });
  });

  test("3i: closeSend draft_changed on an open follow_up send: expired, its draft closed, the loop row unchanged", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sent = await insertSentRow(trx, w.ctx, w.mailboxId, { toAddresses: [TO] });
      const loopId = await insertLoopRow(trx, w.ctx, w.mailboxId, { sent_email_id: sent, to_addresses: [TO] });
      const before = await trx.selectFrom("open_loops").selectAll().where("id", "=", loopId).executeTakeFirstOrThrow();
      const pair = await insertLoopActionPair(trx, w.ctx, loopId, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: ago(HOUR_MS),
      });

      const result = await closeSend(trx, w.ctx, {
        sendId: pair.sendId,
        reason: "draft_changed",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "closed", sendId: pair.sendId });
      expect(await row(trx, pair.sendId)).toMatchObject({ status: "expired", status_reason: "draft_changed" });
      expect((await row(trx, pair.draftId)).status).toBe("expired");
      const after = await trx.selectFrom("open_loops").selectAll().where("id", "=", loopId).executeTakeFirstOrThrow();
      expect(after).toEqual(before);
    });
  });

  test("3j: a send of an unknown id answers not_found", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      expect(
        await closeSend(trx, w.ctx, {
          sendId: randomUUID(),
          reason: "answered",
          notify: false,
          claimed: false,
          now: NOW,
          deps: closeDeps(),
        })
      ).toEqual({ kind: "not_found" });
    });
  });
});
