import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  claimActions,
  countActionsSince,
  countReadyOriginals,
  expireReadyOriginals,
  expireStaleReady,
  finishAction,
  releaseAction,
  releaseActions,
} from "../../src/modules/actions";
import { insertMailbox } from "../../src/modules/mail/repo";

import { createTwoTenants, NOW, STALE_BEFORE, ago, claimOpts, actionState, ready } from "./actions-repo-helpers";
import { insertAction, insertTriagedWithActions, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("finishAction", () => {
  test("needs the claim token; applied and failed set their columns", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [ready("flag"), ready("move")],
      });
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: ago(1000) })
        .execute();
      const [flag, move] = mail.actionIds as [string, string];
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());

      const wrong = new Date(NOW.getTime() + 1);
      expect(await finishAction(trx, a.ctx, flag, wrong, { status: "applied", at: NOW })).toBe(false);
      expect(await actionState(trx, flag)).toMatchObject({ status: "ready", applied_at: null });

      expect(
        await finishAction(trx, a.ctx, flag, NOW, {
          status: "applied",
          at: ago(1000),
          providerResult: { uid: 7 },
        })
      ).toBe(true);
      const applied = await actionState(trx, flag);
      expect(applied).toMatchObject({ status: "applied", locked_at: null, next_attempt_at: null });
      expect(applied.applied_at?.getTime()).toBe(ago(1000).getTime());
      expect(applied.provider_result).toEqual({ uid: 7 });
      expect(await finishAction(trx, a.ctx, flag, NOW, { status: "applied", at: NOW })).toBe(false);

      expect(
        await finishAction(trx, a.ctx, move, NOW, {
          status: "failed",
          at: NOW,
          reason: "mail_not_found",
          lastError: "HardError",
        })
      ).toBe(true);
      expect(await actionState(trx, move)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
        last_error: "HardError",
        locked_at: null,
        next_attempt_at: null,
        applied_at: null,
      });
    });
  });
});

describe("releaseAction and releaseActions", () => {
  test("releaseAction counts an attempt on request and keeps the row ready", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [ready("flag")],
      });
      const [id] = mail.actionIds as [string];
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      const next = new Date(NOW.getTime() + 5 * MINUTE_MS);

      expect(
        await releaseAction(trx, a.ctx, id, new Date(NOW.getTime() + 1), {
          toStatus: "ready",
          nextAttemptAt: next,
          countAttempt: true,
          now: NOW,
        })
      ).toBe(false);
      expect(
        await releaseAction(trx, a.ctx, id, NOW, {
          toStatus: "ready",
          nextAttemptAt: next,
          countAttempt: true,
          now: NOW,
          lastError: "HardError",
        })
      ).toBe(true);
      const state = await actionState(trx, id);
      expect(state).toMatchObject({ status: "ready", attempts: 1, locked_at: null, last_error: "HardError" });
      expect(state.next_attempt_at?.getTime()).toBe(next.getTime());
    });
  });

  test("releaseActions clears the lock and changes neither attempts nor next_attempt_at", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [ready("flag"), ready("mark_read")],
      });
      const [first, second] = mail.actionIds as [string, string];
      await trx
        .updateTable("actions")
        .set({ attempts: 2, next_attempt_at: ago(1000) })
        .execute();
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());

      expect(await releaseActions(trx, a.ctx, [], NOW, NOW)).toBe(0);
      expect(await releaseActions(trx, a.ctx, [first, second], new Date(NOW.getTime() + 1), NOW)).toBe(0);
      expect(await releaseActions(trx, a.ctx, [first, second], NOW, NOW)).toBe(2);
      for (const id of [first, second]) {
        const state = await actionState(trx, id);
        expect(state).toMatchObject({ status: "ready", attempts: 2, locked_at: null });
        expect(state.next_attempt_at?.getTime()).toBe(ago(1000).getTime());
      }
    });
  });
});

describe("expireStaleReady", () => {
  test("expires old ready originals of mailbox types only", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [],
      });
      const old = ago(25 * HOUR_MS);
      const staleMove = await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: old });
      const freshMove = await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(HOUR_MS) });
      const appliedFlag = await insertAction(trx, a.ctx, mail.emailId, {
        type: "flag",
        status: "applied",
        createdAt: old,
      });
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("flag"),
        reversesActionId: appliedFlag,
        createdAt: old,
      });
      const summary = await insertAction(trx, a.ctx, mail.emailId, { ...ready("save_summary"), createdAt: old });
      const lockedMove = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("mark_read"),
        createdAt: old,
        lockedAt: ago(MINUTE_MS),
      });

      const expired = await expireStaleReady(trx, a.ctx, a.mailboxId, { now: NOW, staleBefore: STALE_BEFORE });
      expect(expired).toEqual([{ id: staleMove, emailId: mail.emailId, type: "move" }]);
      expect(await actionState(trx, staleMove)).toMatchObject({ status: "expired", status_reason: "stale" });
      for (const id of [freshMove, reverse, summary, lockedMove]) {
        expect((await actionState(trx, id)).status).toBe("ready");
      }
    });
  });
});

describe("expireReadyOriginals", () => {
  test("types, category, emailId, lock and reverse rows; the reason is stored", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const create = (category: "info" | "spam" | "unsure", uid: number) =>
        insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
          category,
          uid,
          createdAt: ago(HOUR_MS),
          actions: [
            { type: "move", status: "ready", payload: { folder: "ai_info" } },
            { type: "mark_read", status: "ready" },
            { type: "flag", status: "ready" },
          ],
        });
      const info = await create("info", 1);
      const spam = await create("spam", 2);
      const unsure = await create("unsure", 3);
      const [infoMove, infoRead, infoFlag] = info.actionIds as [string, string, string];
      await insertAction(trx, a.ctx, info.emailId, {
        ...ready("move"),
        reversesActionId: infoMove,
        createdAt: ago(1000),
      });
      const locked = await insertAction(trx, a.ctx, info.emailId, {
        ...ready("mark_read"),
        lockedAt: ago(MINUTE_MS),
        createdAt: ago(2000),
      });
      const filter = { mailboxId: a.mailboxId, types: ["move", "mark_read"] as const };
      const opts = { now: NOW, staleBefore: STALE_BEFORE, reason: "policy_changed" as const };

      const expired = await expireReadyOriginals(trx, a.ctx, { ...filter, category: { is: "info" } }, opts);
      expect(expired.map((row) => row.id).sort()).toEqual([infoMove, infoRead].sort());
      expect(expired.find((row) => row.id === infoMove)).toEqual({ id: infoMove, emailId: info.emailId, type: "move" });
      expect(await actionState(trx, infoMove)).toMatchObject({ status: "expired", status_reason: "policy_changed" });
      expect((await actionState(trx, infoFlag)).status).toBe("ready");
      expect((await actionState(trx, locked)).status).toBe("ready");
      for (const id of [...spam.actionIds, ...unsure.actionIds])
        expect((await actionState(trx, id)).status).toBe("ready");
      const reverseRows = await trx
        .selectFrom("actions")
        .select("status")
        .where("reverses_action_id", "=", infoMove)
        .execute();
      expect(reverseRows).toEqual([{ status: "ready" }]);

      const notUnsure = await expireReadyOriginals(
        trx,
        a.ctx,
        { ...filter, emailId: spam.emailId, category: { not: "unsure" } },
        { ...opts, reason: "undo" }
      );
      expect(notUnsure.map((row) => row.emailId)).toEqual([spam.emailId, spam.emailId]);
      expect((await actionState(trx, spam.actionIds[0] as string)).status_reason).toBe("undo");
      expect((await actionState(trx, spam.actionIds[2] as string)).status).toBe("ready");

      const rest = await expireReadyOriginals(trx, a.ctx, { ...filter, category: { not: "info" } }, opts);
      expect(rest.map((row) => row.emailId)).toEqual([unsure.emailId, unsure.emailId]);
      expect(
        await expireReadyOriginals(trx, a.ctx, { mailboxId: a.mailboxId, types: [] }, { ...opts, reason: "manual" })
      ).toEqual([]);
    });
  });

  test("category not: without emailId, expires info and spam, keeps unsure", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const create = (category: "info" | "spam" | "unsure", uid: number) =>
        insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
          category,
          uid,
          createdAt: ago(HOUR_MS),
          actions: [
            { type: "move", status: "ready", payload: { folder: "ai_info" } },
            { type: "mark_read", status: "ready" },
          ],
        });
      const info = await create("info", 1);
      const spam = await create("spam", 2);
      const unsure = await create("unsure", 3);

      const expired = await expireReadyOriginals(
        trx,
        a.ctx,
        { mailboxId: a.mailboxId, types: ["move", "mark_read"], category: { not: "unsure" } },
        { now: NOW, staleBefore: STALE_BEFORE, reason: "policy_changed" }
      );
      expect(expired.map((row) => row.id).sort()).toEqual([...info.actionIds, ...spam.actionIds].sort());
      for (const id of [...info.actionIds, ...spam.actionIds])
        expect((await actionState(trx, id)).status).toBe("expired");
      for (const id of unsure.actionIds) expect((await actionState(trx, id)).status).toBe("ready");
    });
  });
});

describe("countReadyOriginals", () => {
  test("counts the ready originals of the mailbox: not reverse, summary, other statuses, other mailboxes, org B", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [
          { type: "flag", status: "ready" },
          { type: "move", status: "ready", payload: { folder: "ai_info" } },
          { type: "mark_read", status: "applied" },
          { type: "mark_read", status: "failed" },
          { type: "save_summary", status: "ready", payload: { summary: "s" } },
        ],
      });
      await insertAction(trx, a.ctx, mail.emailId, {
        type: "flag",
        status: "ready",
        reversesActionId: mail.actionIds[0] as string,
      });
      const otherMailboxId = crypto.randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await insertTriagedWithActions(trx, a.ctx, otherMailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [{ type: "flag", status: "ready" }],
      });
      await insertTriagedWithActions(trx, b.ctx, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [{ type: "flag", status: "ready" }],
      });

      expect(await countReadyOriginals(trx, a.ctx, a.mailboxId)).toBe(2);
      expect(await countReadyOriginals(trx, b.ctx, a.mailboxId)).toBe(0);
      expect(await countReadyOriginals(trx, b.ctx, b.mailboxId)).toBe(1);
    });
  });
});

describe("countActionsSince", () => {
  test("counts originals of mailbox types: applied flag, undone move; not summary, not reverse", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [
          { type: "flag", status: "applied" },
          { type: "move", status: "undone", payload: { folder: "ai_info" } },
          { type: "save_summary", status: "applied", payload: { summary: "s" } },
          { type: "mark_read", status: "failed" },
        ],
      });
      const [, move] = mail.actionIds as [string, string];
      await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        reversesActionId: move,
        createdAt: ago(1000),
      });
      // too old
      await insertAction(trx, a.ctx, mail.emailId, { type: "flag", status: "applied", createdAt: ago(3 * DAY_MS) });
      await trx
        .updateTable("actions")
        .set({ updated_at: ago(30 * MINUTE_MS) })
        .where("email_id", "=", mail.emailId)
        .execute();

      expect(await countActionsSince(trx, a.ctx, { since: ago(2 * HOUR_MS) })).toEqual({
        applied: 1,
        failed: 1,
        undone: 1,
      });
    });
  });
});
