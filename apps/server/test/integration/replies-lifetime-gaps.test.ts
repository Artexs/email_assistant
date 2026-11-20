import { randomBytes } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createCommitterJob,
  createFolderResolver,
  editApproval,
  noDelegationHooks,
  type ApplyDeps,
  type ClaimedAction,
} from "../../src/modules/actions";
import { composeMessage } from "../../src/modules/mail";
import { insertCredentials } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { NOW, ago, type World, world, reply, approvalDeps, tap, row } from "./replies-lifetime-helpers";
import { putDraftCopy } from "./reply-fixtures";

// The gap rule and the flag rule of a reply send. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

async function addCredentials(trx: Transaction<DB>, w: World): Promise<void> {
  const secret = secrets.encrypt("pw", `mailbox:${w.mailboxId}`);
  await insertCredentials(trx, w.ctx, {
    mailboxId: w.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
}

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
        organization: { timezone: "Europe/Warsaw" },
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
        organization: { timezone: "Europe/Warsaw" },
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
