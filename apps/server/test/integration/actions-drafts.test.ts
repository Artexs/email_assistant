import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  applyDraft,
  buildDraftMessage,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  listFailedUnnotified,
  noDelegationHooks,
  reject,
  RETRY_WAIT_MS,
  type ApplyDeps,
  type ClaimedAction,
  type DelegationHooks,
} from "../../src/modules/actions";
import { lockSend } from "../../src/modules/actions/repo";
import { composeMessage, MailAuthError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertAction, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const MINUTE = 60_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const CREATED = new Date("2026-11-07T11:00:00Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const DELEGATION_ID = "11111111-1111-4111-8111-111111111111";

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  appended: Buffer[];
  folderMap: Record<string, string>;
}

// The fake keeps no readable raw: the wrapper records every APPEND.
async function setup(trx: Transaction<DB>, opts: { folderMap?: Record<string, string> } = {}): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = opts.folderMap ?? { drafts: "Drafts" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  if (opts.folderMap === undefined) await fake.ensureFolder("Drafts");
  const appended: Buffer[] = [];
  const append = fake.appendMessage.bind(fake);
  fake.appendMessage = async (folder, raw, flags, internalDate) => {
    appended.push(raw);
    return append(folder, raw, flags, internalDate);
  };
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    appended,
    folderMap,
  };
}

function recordingHooks() {
  const calls: { delegationId: string; reason: string; at: Date }[] = [];
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onCancelled: async (_trx, _ctx, input) => {
      calls.push(input);
      return true;
    },
  };
  return { hooks, calls };
}

function depsOf(s: Setup, trx: Db | Transaction<DB>, at: Date = NOW, over: Partial<ApplyDeps> = {}): ApplyDeps {
  const folders = createFolderResolver(
    { db: trx, now: () => at, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: trx,
    now: () => at,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
    ...over,
  };
}

async function claimOne(trx: Transaction<DB>, s: Setup, id: string, at: Date = NOW): Promise<ClaimedAction> {
  const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
    now: at,
    limit: 20,
    staleBefore: new Date(at.getTime() - 10 * MINUTE),
    filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
  });
  const action = claimed.find((row) => row.id === id);
  if (action === undefined) throw new Error("the draft was not claimed");
  return action;
}

async function actionState(trx: Db | Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function reverseRows(trx: Db | Transaction<DB>, s: Setup, draftId: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("reverses_action_id", "=", draftId)
    .execute();
}

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

async function draftUids(s: Setup, folder = "Drafts"): Promise<number[]> {
  return s.fake.searchSinceIn(folder, new Date(0));
}

function appendCalls(s: Setup): number {
  return s.fake.calls.filter((call) => call === "appendMessage").length;
}

const MAIL = {
  createdAt: CREATED,
  from: "boss@x.test",
  subject: "Offer",
  messageId: "<orig-1@x.test>",
  bodyText: "Please prepare the offer",
};

describe("applyDraft", () => {
  test("a delegation draft becomes one message in Drafts with the system header", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      const uids = await draftUids(s);
      expect(uids).toHaveLength(1);
      const meta = await s.fake.fetchMetaIn("Drafts", uids[0] as number);
      expect(meta?.actionId).toBe(p.draftId);
      expect(meta?.messageId).toBe(`<ea-${p.draftId}@${s.address.split("@")[1]}>`);
      expect(meta?.flags).toEqual(["\\Draft"]);
      expect(meta?.internalDate.getTime()).toBe(CREATED.getTime());

      const row = await actionState(trx, p.draftId);
      expect(row.status).toBe("applied");
      expect(row.locked_at).toBeNull();
      expect(row.provider_result).toEqual({ uid: uids[0], folder: "Drafts", found: false });

      const raw = s.appended[0]?.toString("utf8") ?? "";
      expect(raw).toContain("> Please prepare the offer");
      expect(raw).toContain("Owner");

      const audit = await auditRows(trx, s);
      expect(audit.map((a) => a.event)).toEqual(["action.applying", "action.applied"]);
      expect(audit[1]?.data).toEqual({ action_type: "create_draft", kind: "delegation", found: false });
    });
  });

  test("crash after the APPEND: the next claim finds the message and appends nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);
      const crash = new Error("crash");

      await expect(
        applyDraft(
          depsOf(s, trx, NOW, {
            beforeCommit: () => {
              throw crash;
            },
          }),
          s.ctx,
          action,
          s.fake
        )
      ).rejects.toBe(crash);
      const stuck = await actionState(trx, p.draftId);
      expect(stuck.status).toBe("applying");
      expect(stuck.locked_at?.getTime()).toBe(NOW.getTime());
      expect(await draftUids(s)).toHaveLength(1);

      const later = new Date(NOW.getTime() + 11 * MINUTE);
      const again = await claimOne(trx, s, p.draftId, later);
      expect(again.status).toBe("applying");
      expect(await applyDraft(depsOf(s, trx, later), s.ctx, again, s.fake)).toEqual({ kind: "applied" });

      const uids = await draftUids(s);
      expect(uids).toHaveLength(1);
      expect(appendCalls(s)).toBe(1);
      const row = await actionState(trx, p.draftId);
      expect(row.status).toBe("applied");
      expect(row.provider_result).toEqual({ uid: uids[0], folder: "Drafts", found: true });
    });
  });

  test("a folder_map without drafts creates Drafts and stores the path", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { folderMap: {} });
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      expect(await draftUids(s)).toHaveLength(1);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("folder_map")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect((mailbox.folder_map as Record<string, string>).drafts).toBe("Drafts");
    });
  });

  test("a soft APPEND error keeps the row applying; the next claim appends once", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);
      s.fake.failOn("appendMessage", new SoftError("timeout"));

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "retry", soft: true });
      const row = await actionState(trx, p.draftId);
      expect(row).toMatchObject({ status: "applying", locked_at: null, attempts: 0 });
      expect(row.next_attempt_at?.getTime()).toBe(NOW.getTime() + RETRY_WAIT_MS);

      const later = new Date(NOW.getTime() + 6 * MINUTE);
      const again = await claimOne(trx, s, p.draftId, later);
      expect(await applyDraft(depsOf(s, trx, later), s.ctx, again, s.fake)).toEqual({ kind: "applied" });
      expect(await draftUids(s)).toHaveLength(1);
      expect((await actionState(trx, p.draftId)).provider_result).toMatchObject({ found: false });
    });
  });

  test("three hard APPEND errors fail the draft and expire its send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { hooks, calls } = recordingHooks();
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        draftStatus: "ready",
        delegationId: DELEGATION_ID,
      });
      s.fake.failOn("appendMessage", new HardError("boom"), 3);

      let at = NOW;
      const outcomes: unknown[] = [];
      const attempts: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const action = await claimOne(trx, s, p.draftId, at);
        outcomes.push(await applyDraft(depsOf(s, trx, at, { hooks }), s.ctx, action, s.fake));
        attempts.push((await actionState(trx, p.draftId)).attempts);
        at = new Date(at.getTime() + 6 * MINUTE);
      }

      expect(outcomes).toEqual([
        { kind: "retry", soft: false },
        { kind: "retry", soft: false },
        { kind: "failed", reason: "hard_error" },
      ]);
      expect(attempts.slice(0, 2)).toEqual([1, 2]);
      expect(await actionState(trx, p.draftId)).toMatchObject({
        status: "failed",
        status_reason: "hard_error",
        locked_at: null,
      });
      expect(await actionState(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "draft_missing",
        result_notified_at: null,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ delegationId: DELEGATION_ID, reason: "draft_missing" });
      const failed = await listFailedUnnotified(trx, s.ctx, { limit: 50 });
      expect(failed.map((row) => row.id)).not.toContain(p.draftId);
    });
  });

  test("a bad payload fails the draft and expires its send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "nope" }) })
        .where("id", "=", p.draftId)
        .execute();
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({
        kind: "failed",
        reason: "bad_payload",
      });
      expect(await actionState(trx, p.draftId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(appendCalls(s)).toBe(0);
    });
  });

  test("a clarification draft goes to the sender as a reply", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        kind: "clarification",
        to: "boss@x.test",
        task: "Which supplier?",
        draftStatus: "ready",
      });
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      const raw = s.appended[0]?.toString("utf8") ?? "";
      expect(raw).toMatch(/^Subject: Re: Offer/m);
      expect(raw).toMatch(/^To: .*boss@x\.test/m);
      expect(raw).toMatch(/^In-Reply-To: <orig-1@x\.test>/m);
    });
  });

  test("a reminder draft quotes nothing and keeps the thread of the delegation", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        reminder: 1,
        delegationId: DELEGATION_ID,
        draftStatus: "ready",
      });
      const row = await actionState(trx, p.draftId);
      await trx
        .updateTable("actions")
        .set({
          payload: JSON.stringify({
            ...(row.payload as Record<string, unknown>),
            thread: { in_reply_to: "<sent-1@x.test>", references: ["<orig-1@x.test>", "<sent-1@x.test>"] },
          }),
        })
        .where("id", "=", p.draftId)
        .execute();
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      const raw = s.appended[0]?.toString("utf8") ?? "";
      expect(raw).not.toContain("Original message");
      expect(raw).not.toContain("> Please prepare");
      expect(raw).toMatch(/^In-Reply-To: <sent-1@x\.test>/m);
    });
  });

  test("buildDraftMessage uses the mail, the owner and the mailbox", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        draftStatus: "ready",
        referencesHeader: "<a@x.test> <b@x.test>",
      });
      const action = await claimOne(trx, s, p.draftId);

      const message = buildDraftMessage(depsOf(s, trx), action);

      expect(message.messageId).toBe(`<ea-${p.draftId}@${s.address.split("@")[1]}>`);
      expect(message.date.getTime()).toBe(CREATED.getTime());
      expect(message.from).toEqual({ name: "Owner", address: s.address });
      expect(message.references).toEqual(["<a@x.test>", "<b@x.test>", "<orig-1@x.test>"]);
      expect(message.headers["X-EA-Action-Id"]).toBe(p.draftId);
    });
  });

  test("a login error from ensureFolder gives auth_error and leaves the row applying and locked", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);
      s.fake.failOn("ensureFolder", new MailAuthError("login"));

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "auth_error" });

      const row = await actionState(trx, p.draftId);
      expect(row.status).toBe("applying");
      expect(row.locked_at?.getTime()).toBe(NOW.getTime());
      expect(appendCalls(s)).toBe(0);
    });
  });

  test("a dead send: no APPEND, the draft expires with send_closed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        draftStatus: "applying",
        sendStatus: "rejected",
      });
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({
        kind: "expired",
        reason: "send_closed",
      });

      expect(appendCalls(s)).toBe(0);
      expect(await actionState(trx, p.draftId)).toMatchObject({
        status: "expired",
        status_reason: "send_closed",
        locked_at: null,
      });
      const audit = await auditRows(trx, s);
      expect(audit.map((a) => a.event)).toEqual(["action.expired"]);
      expect(audit[0]?.reason_code).toBe("send_closed");
    });
  });

  test("a dead send but the message had landed: applied with found, and a reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        draftStatus: "applying",
        sendStatus: "rejected",
      });
      const action = await claimOne(trx, s, p.draftId);
      const raw = await composeMessage(buildDraftMessage(depsOf(s, trx), action));
      const { uid } = await s.fake.appendMessage("Drafts", raw, ["\\Draft"], CREATED);
      const before = appendCalls(s);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      expect(appendCalls(s)).toBe(before);
      expect((await actionState(trx, p.draftId)).provider_result).toEqual({ uid, folder: "Drafts", found: true });
      const reverses = await reverseRows(trx, s, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({ type: "create_draft", status: "ready" });
      expect(reverses[0]?.payload).toEqual({ kind: "delegation", folder: "Drafts", uid, reason: "rejected" });
    });
  });

  test("a reject during the APPEND: the final transaction inserts the one reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      const action = await claimOne(trx, s, p.draftId);
      const deps = depsOf(s, trx, NOW, {
        beforeCommit: async () => {
          const result = await reject(
            { db: trx, hooks: noDelegationHooks, uidplus: async () => true },
            s.ctx,
            p.sendId,
            { userId: s.userId, via: "cli", now: NOW }
          );
          expect(result).toEqual({ kind: "rejected" });
        },
      });

      expect(await applyDraft(deps, s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "rejected" });
      expect((await actionState(trx, p.draftId)).status).toBe("applied");
      const reverses = await reverseRows(trx, s, p.draftId);
      expect(reverses).toHaveLength(1);
      expect(reverses[0]?.payload).toMatchObject({ reason: "rejected" });
    });
  });
});

describe("committer job with drafts", () => {
  async function jobSetup(trx: Transaction<DB>) {
    await pauseOtherMailboxes(trx);
    const s = await setup(trx);
    const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
    await insertCredentials(trx, s.ctx, {
      mailboxId: s.mailboxId,
      encryptedSecret: secret.ciphertext,
      secretKind: "password",
      keyVersion: secret.keyVersion,
    });
    const job = createCommitterJob({
      db: trx,
      secrets,
      openProvider: async () => s.fake,
      scope: { kind: "all", mailboxAddress: s.address },
      now: () => NOW,
    });
    return { s, job };
  }

  test("a batch with only a draft opens the provider and applies it", async () => {
    await withRollback(db, async (trx) => {
      const { s, job } = await jobSetup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });

      await job.run();

      expect(await actionState(trx, p.draftId)).toMatchObject({ status: "applied", locked_at: null });
      expect(await draftUids(s)).toHaveLength(1);
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("a login error inside the draft step releases the row applying and sets auth_error", async () => {
    await withRollback(db, async (trx) => {
      const { s, job } = await jobSetup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      s.fake.failOn("ensureFolder", new MailAuthError("login"));

      await job.run();

      expect(await actionState(trx, p.draftId)).toMatchObject({ status: "applying", locked_at: null });
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("status")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status).toBe("auth_error");
    });
  });
});

describe("removeDraft", () => {
  // An applied draft in the fake Drafts folder and a ready reverse row for it.
  async function appliedWithReverse(
    trx: Transaction<DB>,
    s: Setup,
    reason: "sent" | "rejected" | "expired" = "sent"
  ): Promise<{ draftId: string; reverseId: string; uid: number }> {
    const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
    const draft = await claimOne(trx, s, p.draftId);
    expect(await applyDraft(depsOf(s, trx), s.ctx, draft, s.fake)).toEqual({ kind: "applied" });
    const row = await actionState(trx, p.draftId);
    const uid = (row.provider_result as { uid: number }).uid;
    const reverseId = await insertAction(trx, s.ctx, p.emailId, {
      type: "create_draft",
      status: "ready",
      payload: { kind: "delegation", folder: "Drafts", uid, reason },
      reversesActionId: p.draftId,
      idempotencyKey: `${p.draftId}:undo`,
      createdAt: new Date(NOW.getTime() + MINUTE),
    });
    return { draftId: p.draftId, reverseId, uid };
  }

  test("the reverse row removes the draft and marks the original undone with the reason", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { draftId, reverseId } = await appliedWithReverse(trx, s, "sent");
      const reverse = await claimOne(trx, s, reverseId);
      expect(reverse.original_created_at?.getTime()).toBe(CREATED.getTime());

      expect(await applyAction(depsOf(s, trx), s.ctx, reverse, s.fake)).toEqual({ kind: "applied" });

      expect(await draftUids(s)).toEqual([]);
      const row = await actionState(trx, reverseId);
      expect(row.status).toBe("applied");
      expect(row.provider_result).toMatchObject({ found: true });
      expect(await actionState(trx, draftId)).toMatchObject({ status: "undone", status_reason: "sent" });
      const audit = await auditRows(trx, s);
      expect(audit.map((a) => a.event)).toEqual([
        "action.applying",
        "action.applied",
        "action.applied",
        "action.undone",
      ]);
      expect(audit[2]?.data).toEqual({ action_type: "create_draft", reverse: true, found: true });
      expect(audit[3]).toMatchObject({ action_id: draftId });
      expect(audit[3]?.data).toEqual({ reverse_action_id: reverseId, reason: "sent" });
    });
  });

  test("a draft that is gone already: applied with found false, the original undone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { draftId, reverseId, uid } = await appliedWithReverse(trx, s, "rejected");
      await s.fake.deleteMessage("Drafts", uid);
      const reverse = await claimOne(trx, s, reverseId);

      expect(await applyAction(depsOf(s, trx), s.ctx, reverse, s.fake)).toEqual({ kind: "applied" });

      expect((await actionState(trx, reverseId)).provider_result).toMatchObject({ found: false });
      expect(await actionState(trx, draftId)).toMatchObject({ status: "undone", status_reason: "rejected" });
    });
  });

  test("another draft in the same folder stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const other = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        ...MAIL,
        messageId: "<orig-2@x.test>",
        draftStatus: "ready",
      });
      const otherDraft = await claimOne(trx, s, other.draftId);
      expect(await applyDraft(depsOf(s, trx), s.ctx, otherDraft, s.fake)).toEqual({ kind: "applied" });
      const { reverseId } = await appliedWithReverse(trx, s);
      expect(await draftUids(s)).toHaveLength(2);
      const reverse = await claimOne(trx, s, reverseId);

      expect(await applyAction(depsOf(s, trx), s.ctx, reverse, s.fake)).toEqual({ kind: "applied" });

      const left = await draftUids(s);
      expect(left).toHaveLength(1);
      expect((await s.fake.fetchMetaIn("Drafts", left[0] as number))?.actionId).toBe(other.draftId);
    });
  });

  test("a hard error three times: failed, the original stays applied, the notice detector lists it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { draftId, reverseId } = await appliedWithReverse(trx, s);
      s.fake.failOn("deleteMessage", new HardError("boom"), 3);

      let at = NOW;
      const outcomes: unknown[] = [];
      for (let n = 0; n < 3; n += 1) {
        at = new Date(at.getTime() + 10 * MINUTE);
        const reverse = await claimOne(trx, s, reverseId, at);
        outcomes.push(await applyAction(depsOf(s, trx, at), s.ctx, reverse, s.fake));
        if (n < 2) expect(await actionState(trx, reverseId)).toMatchObject({ status: "ready", attempts: n + 1 });
      }

      expect(outcomes).toEqual([
        { kind: "retry", soft: false },
        { kind: "retry", soft: false },
        { kind: "failed", reason: "hard_error" },
      ]);
      expect(await actionState(trx, reverseId)).toMatchObject({
        status: "failed",
        status_reason: "hard_error",
        notified_at: null,
      });
      expect((await actionState(trx, draftId)).status).toBe("applied");
      const listed = await listFailedUnnotified(trx, s.ctx, { limit: 10 });
      expect(listed.map((row) => row.id)).toEqual([reverseId]);
    });
  });

  test("crash after the delete: the next claim finds nothing, the original is undone, one delete call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { draftId, reverseId } = await appliedWithReverse(trx, s);
      const reverse = await claimOne(trx, s, reverseId);
      const crash = new Error("crash");

      await expect(
        applyAction(
          depsOf(s, trx, NOW, {
            beforeCommit: () => {
              throw crash;
            },
          }),
          s.ctx,
          reverse,
          s.fake
        )
      ).rejects.toBe(crash);
      const stuck = await actionState(trx, reverseId);
      expect(stuck.status).toBe("ready");
      expect(stuck.locked_at?.getTime()).toBe(NOW.getTime());

      const later = new Date(NOW.getTime() + 11 * MINUTE);
      const again = await claimOne(trx, s, reverseId, later);
      expect(await applyAction(depsOf(s, trx, later), s.ctx, again, s.fake)).toEqual({ kind: "applied" });

      expect((await actionState(trx, reverseId)).provider_result).toMatchObject({ found: false });
      expect(await actionState(trx, draftId)).toMatchObject({ status: "undone", status_reason: "sent" });
      expect(s.fake.calls.filter((call) => call === "deleteMessage")).toHaveLength(1);
    });
  });
});

describe("a failing draft and a reject on two connections", () => {
  test("no deadlock: the send lock comes first, one consistent end state", async () => {
    const created = await db.transaction().execute((trx) => setup(trx));
    const ctx = created.ctx;
    try {
      const p = await db.transaction().execute(async (trx) => {
        const pair = await insertDraftAndSend(trx, ctx, created.mailboxId, { ...MAIL, draftStatus: "ready" });
        await trx.updateTable("actions").set({ attempts: 2 }).where("id", "=", pair.draftId).execute();
        return pair;
      });
      const action = await db.transaction().execute((trx) => claimOne(trx, created, p.draftId));
      created.fake.failOn("appendMessage", new HardError("boom"));

      // The reject side holds the send lock; the draft side starts and must wait for the send, not hold the draft.
      let failing: Promise<{ result?: unknown; error?: unknown }> | undefined;
      const rejected = await db.transaction().execute(async (trx) => {
        await lockSend(trx, ctx, p.sendId);
        failing = applyDraft(depsOf(created, db), ctx, action, created.fake).then(
          (result) => ({ result }),
          (error: unknown) => ({ error })
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        return reject({ db: trx, hooks: noDelegationHooks, uidplus: async () => true }, ctx, p.sendId, {
          userId: created.userId,
          via: "cli",
          now: NOW,
        });
      });
      const outcome = await failing;

      expect(rejected).toEqual({ kind: "rejected" });
      expect(outcome).toEqual({ result: { kind: "failed", reason: "hard_error" } });
      expect(await actionState(db, p.sendId)).toMatchObject({ status: "rejected" });
      expect(await actionState(db, p.draftId)).toMatchObject({ status: "failed", status_reason: "hard_error" });
      expect(await reverseRows(db, created, p.draftId)).toEqual([]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", ctx.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});
