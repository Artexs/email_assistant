import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applyAction,
  applyDraft,
  listFailedUnnotified,
  noApprovalHooks,
  noDelegationHooks,
  reject,
} from "../../src/modules/actions";
import { lockSend } from "../../src/modules/actions/repo";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

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
import { insertAction, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
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
      createdAt: new Date(NOW.getTime() + MINUTE_MS),
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

  test("a reverse row with the reason expired marks the original undone with that reason", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { draftId, reverseId } = await appliedWithReverse(trx, s, "expired");
      const reverse = await claimOne(trx, s, reverseId);

      expect(await applyAction(depsOf(s, trx), s.ctx, reverse, s.fake)).toEqual({ kind: "applied" });

      expect(await actionState(trx, draftId)).toMatchObject({ status: "undone", status_reason: "expired" });
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
        at = new Date(at.getTime() + 10 * MINUTE_MS);
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

      const later = new Date(NOW.getTime() + 11 * MINUTE_MS);
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
        return reject(
          { db: trx, hooks: noDelegationHooks, approvalHooks: noApprovalHooks, uidplus: async () => true },
          ctx,
          p.sendId,
          {
            userId: created.userId,
            via: "cli",
            now: NOW,
          }
        );
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
