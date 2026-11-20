import { randomBytes } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyDraft,
  buildDraftMessage,
  createCommitterJob,
  listFailedUnnotified,
  noApprovalHooks,
  noDelegationHooks,
  reject,
  RETRY_WAIT_MS,
  type DelegationHooks,
} from "../../src/modules/actions";
import { composeMessage, MailAuthError } from "../../src/modules/mail";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import {
  NOW,
  CREATED,
  Setup,
  setup,
  depsOf,
  claimOne,
  actionState,
  reverseRows,
  auditRows,
  draftUids,
  MAIL,
} from "./actions-drafts-helpers";
import { insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The hash of the Drafts copy that the draft step reads once after its APPEND (the baseline of the edit check).
const HEX64 = expect.stringMatching(/^[0-9a-f]{64}$/);

const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const DELEGATION_ID = "11111111-1111-4111-8111-111111111111";

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

function appendCalls(s: Setup): number {
  return s.fake.calls.filter((call) => call === "appendMessage").length;
}

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
      expect(row.provider_result).toEqual({ uid: uids[0], folder: "Drafts", found: false, copy_hash: HEX64 });

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

      const later = new Date(NOW.getTime() + 11 * MINUTE_MS);
      const again = await claimOne(trx, s, p.draftId, later);
      expect(again.status).toBe("applying");
      expect(await applyDraft(depsOf(s, trx, later), s.ctx, again, s.fake)).toEqual({ kind: "applied" });

      const uids = await draftUids(s);
      expect(uids).toHaveLength(1);
      expect(appendCalls(s)).toBe(1);
      const row = await actionState(trx, p.draftId);
      expect(row.status).toBe("applied");
      expect(row.provider_result).toEqual({ uid: uids[0], folder: "Drafts", found: true, copy_hash: HEX64 });
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

      const later = new Date(NOW.getTime() + 6 * MINUTE_MS);
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
        at = new Date(at.getTime() + 6 * MINUTE_MS);
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

  test("a mail with a cleared body (body_text null) still gets its draft: the template and the no-text marker, no quote of text (A24)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const p = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { ...MAIL, draftStatus: "ready" });
      await trx
        .updateTable("emails")
        .set({ body_text: null })
        .where("id", "=", p.emailId)
        .where("org_id", "=", s.ctx.orgId)
        .execute();
      const action = await claimOne(trx, s, p.draftId);

      expect(await applyDraft(depsOf(s, trx), s.ctx, action, s.fake)).toEqual({ kind: "applied" });

      expect(appendCalls(s)).toBe(1);
      const raw = s.appended[0]?.toString("utf8") ?? "";
      expect(raw).toContain("Owner");
      expect(raw).not.toContain("Please prepare the offer");
      // The builder quotes the marker "(no text)" for a null body and nothing else.
      expect(raw).toContain("> (no text)");
      expect(raw.match(/^> .*$/gm)).toEqual(["> (no text)"]);
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
      expect((await actionState(trx, p.draftId)).provider_result).toEqual({
        uid,
        folder: "Drafts",
        found: true,
        copy_hash: HEX64,
      });
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
            { db: trx, hooks: noDelegationHooks, approvalHooks: noApprovalHooks, uidplus: async () => true },
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
      scope: { kind: "all" },
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
