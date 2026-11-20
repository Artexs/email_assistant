import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  claimActions,
  countClaimable,
  countHeldSends,
  finishAction,
  markApplying,
  releaseAction,
  releaseActions,
  updateProviderResult,
  APPROVAL_TTL_MS,
} from "../../src/modules/actions";

import {
  NOW,
  ago,
  claimOpts,
  countOpts,
  actionState,
  ready,
  setupOrgs,
  approvedNow,
  idsOf,
} from "./actions-repo-helpers";
import { createOrgWithMailbox, insertAction, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("claimActions: drafts and sends (D16, D17)", () => {
  test("7: markApplying needs the token and the status approved or ready", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      const [send] = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(send?.id).toBe(pair.sendId);
      expect(await markApplying(trx, a.ctx, pair.sendId, new Date(NOW.getTime() + 1))).toBe(false);
      expect(await actionState(trx, pair.sendId)).toMatchObject({ status: "approved", outgoing_message_id: null });
      expect(await markApplying(trx, a.ctx, pair.sendId, NOW, { outgoingMessageId: "<out-1@x.test>" })).toBe(true);
      const state = await actionState(trx, pair.sendId);
      expect(state).toMatchObject({ status: "applying", outgoing_message_id: "<out-1@x.test>" });
      expect(state.locked_at?.getTime()).toBe(NOW.getTime());
      // applying -> applying is not a start
      expect(await markApplying(trx, a.ctx, pair.sendId, NOW)).toBe(false);
      // applied -> false
      expect(await markApplying(trx, a.ctx, pair.draftId, NOW)).toBe(false);
    });
  });

  test("7: markApplying moves a claimed ready draft and keeps the outgoing id when none is given", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(await markApplying(trx, a.ctx, pair.draftId, NOW)).toBe(true);
      expect(await actionState(trx, pair.draftId)).toMatchObject({ status: "applying", outgoing_message_id: null });
    });
  });

  test("8: finishAction from applying: applied, failed with provider_result, expired, and the from list", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const mk = (status: string) =>
        insertDraftAndSend(trx, a.ctx, a.mailboxId, {
          sendStatus: status,
          approved: approvedNow(userId),
          lockedAt: NOW,
          createdAt: ago(HOUR_MS),
        });
      const one = await mk("applying");
      expect(await finishAction(trx, a.ctx, one.sendId, NOW, { status: "applied", at: NOW })).toBe(true);
      expect(await actionState(trx, one.sendId)).toMatchObject({
        status: "applied",
        locked_at: null,
        last_error: null,
      });

      const two = await mk("applying");
      await trx.updateTable("actions").set({ last_error: "old" }).where("id", "=", two.sendId).execute();
      expect(
        await finishAction(trx, a.ctx, two.sendId, NOW, {
          status: "failed",
          at: NOW,
          reason: "smtp_rejected",
          lastError: "smtp_550",
          providerResult: { stage: "rcpt", response_code: 550 },
        })
      ).toBe(true);
      const failed = await actionState(trx, two.sendId);
      expect(failed).toMatchObject({
        status: "failed",
        status_reason: "smtp_rejected",
        last_error: "smtp_550",
        provider_result: { stage: "rcpt", response_code: 550 },
        locked_at: null,
      });

      // the default from list is ready and applying: an approved row needs the explicit list
      const three = await mk("approved");
      const failNext = { status: "failed", at: NOW, reason: "smtp_error" } as const;
      expect(await finishAction(trx, a.ctx, three.sendId, NOW, failNext)).toBe(false);
      expect(await finishAction(trx, a.ctx, three.sendId, NOW, failNext, { from: ["approved"] })).toBe(true);

      const four = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "applying",
        createdAt: ago(HOUR_MS),
      });
      await trx.updateTable("actions").set({ locked_at: NOW }).where("id", "=", four.draftId).execute();
      expect(
        await finishAction(trx, a.ctx, four.draftId, NOW, { status: "expired", at: NOW, reason: "send_closed" })
      ).toBe(true);
      expect(await actionState(trx, four.draftId)).toMatchObject({
        status: "expired",
        status_reason: "send_closed",
        locked_at: null,
      });
    });
  });

  test("9: releaseAction sets toStatus; releaseActions keeps the statuses", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: approvedNow(userId),
        lockedAt: NOW,
        createdAt: ago(HOUR_MS),
      });
      expect(
        await releaseAction(trx, a.ctx, pair.sendId, NOW, {
          toStatus: "approved",
          nextAttemptAt: null,
          countAttempt: true,
          now: NOW,
        })
      ).toBe(true);
      expect(await actionState(trx, pair.sendId)).toMatchObject({ status: "approved", attempts: 1, locked_at: null });

      const approved = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        lockedAt: NOW,
        createdAt: ago(HOUR_MS),
      });
      const applying = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: approvedNow(userId),
        lockedAt: NOW,
        createdAt: ago(HOUR_MS),
      });
      expect(await releaseActions(trx, a.ctx, [approved.sendId, applying.sendId], NOW, NOW)).toBe(2);
      expect(await actionState(trx, approved.sendId)).toMatchObject({ status: "approved", locked_at: null });
      expect(await actionState(trx, applying.sendId)).toMatchObject({ status: "applying", locked_at: null });
    });
  });

  test("10: updateProviderResult merges into an existing object", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(HOUR_MS) });
      await trx
        .updateTable("actions")
        .set({ provider_result: JSON.stringify({ response: "250 ok", sent_copy: "pending" }) })
        .where("id", "=", pair.sendId)
        .execute();
      expect(await updateProviderResult(trx, b.ctx, pair.sendId, { sent_copy: "failed" })).toBe(false);
      expect(await updateProviderResult(trx, a.ctx, pair.sendId, { sent_copy: "failed" })).toBe(true);
      expect((await actionState(trx, pair.sendId)).provider_result).toEqual({
        response: "250 ok",
        sent_copy: "failed",
      });
      // a null provider_result becomes the patch
      expect(await updateProviderResult(trx, a.ctx, pair.draftId, { uid: 3 })).toBe(true);
      expect((await actionState(trx, pair.draftId)).provider_result).toEqual({ uid: 3 });
    });
  });

  test("11: the order for one mail is move, create_draft, send", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      // a second draft (reminder) of the same mail is ready with a waiting send; the order is by type rank
      const move = await insertAction(trx, a.ctx, pair.emailId, { ...ready("move"), createdAt: ago(HOUR_MS) });
      const second = await insertAction(trx, a.ctx, pair.emailId, {
        type: "create_draft",
        status: "ready",
        payload: { kind: "reminder" },
        createdAt: ago(HOUR_MS),
      });
      const secondSend = await insertAction(trx, a.ctx, pair.emailId, {
        type: "send",
        status: "awaiting_approval",
        payload: { kind: "reminder", to: ["d@x.test"] },
        dependsOnActionId: second,
        createdAt: ago(HOUR_MS),
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => [row.id, row.type])).toEqual([
        [move, "move"],
        [second, "create_draft"],
        [pair.sendId, "send"],
      ]);
      expect(claimed.map((row) => row.id)).not.toContain(secondSend);
    });
  });

  test("12: a draft of mail received 8 days ago is claimed; a move of it is not", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      await trx
        .updateTable("emails")
        .set({ received_at: ago(8 * DAY_MS) })
        .where("id", "=", pair.emailId)
        .execute();
      await insertAction(trx, a.ctx, pair.emailId, { ...ready("move"), createdAt: ago(HOUR_MS) });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.type)).toEqual(["create_draft"]);
    });
  });

  test("13: org B's context claims and counts nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, userId } = await setupOrgs(trx);
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      expect(await claimActions(trx, b.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await countClaimable(trx, b.ctx, a.mailboxId, countOpts())).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });
      expect(await countHeldSends(trx, b.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(0);
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(1);
    });
  });

  test("14: two connections: a send claimed in an open transaction is skipped by the other", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      const pair = await db.transaction().execute((trx) =>
        insertDraftAndSend(trx, ctx, created.mailboxId, {
          sendStatus: "approved",
          approved: { userId: created.userId, at: ago(MINUTE_MS) },
          createdAt: ago(HOUR_MS),
        })
      );
      let first: { id: string }[] = [];
      let second: { id: string }[] = [];
      await db.transaction().execute(async (trx1) => {
        first = await claimActions(trx1, ctx, created.mailboxId, claimOpts());
        second = await claimActions(db, ctx, created.mailboxId, claimOpts());
      });
      expect(first.map((row) => row.id)).toEqual([pair.sendId]);
      expect(second).toEqual([]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });

  test("15: a reverse draft row carries original_created_at", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "applied",
        sendStatus: "rejected",
        createdAt: ago(3 * HOUR_MS),
      });
      const reverse = await insertAction(trx, a.ctx, pair.emailId, {
        type: "create_draft",
        status: "ready",
        payload: { kind: "delegation", folder: "Drafts", uid: 4, reason: "rejected" },
        reversesActionId: pair.draftId,
        idempotencyKey: `${pair.draftId}:undo`,
        createdAt: ago(HOUR_MS),
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id)).toEqual([reverse]);
      expect(claimed[0]?.reverses_action_id).toBe(pair.draftId);
      expect(claimed[0]?.original_created_at?.getTime()).toBe(ago(3 * HOUR_MS).getTime());
      expect(claimed[0]?.created_at.getTime()).toBe(ago(HOUR_MS).getTime());
    });
  });

  test("15b: an approved send older than 48 h after the tap is not claimed or counted; recovery has no age rule", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const old = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId, at: ago(APPROVAL_TTL_MS + HOUR_MS) },
        createdAt: ago(3 * DAY_MS),
      });
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });

      const young = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId, at: ago(APPROVAL_TTL_MS - HOUR_MS) },
        createdAt: ago(3 * DAY_MS),
      });
      expect(idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts()))).toEqual([young.sendId]);

      await trx
        .updateTable("actions")
        .set({ status: "applying", locked_at: null })
        .where("id", "=", old.sendId)
        .execute();
      expect(idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts()))).toEqual([old.sendId]);
    });
  });

  test("16: countHeldSends counts approved sends with an applied draft that the send filter does not admit", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        to: "b@x.test",
        createdAt: ago(HOUR_MS),
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      // an applying send and an awaiting one are not "held approved" sends
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(HOUR_MS) });
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(1);
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "self", addresses: ["b@x.test"] } })).toBe(
        0
      );
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "self", addresses: ["c@x.test"] } })).toBe(
        1
      );
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "all" } })).toBe(0);
    });
  });
});
