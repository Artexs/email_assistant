import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { approve, reject, type ApprovalHooks, type SendScope } from "../../src/modules/actions";
import { cardEditHooks, insertOutbox } from "../../src/modules/channels";
import { checkCardEdit } from "../../src/modules/channels/card-edit-check";

import {
  captureLogs,
  CARD_AT,
  NOW,
  edits,
  CLOCK,
  type World,
  world,
  depsOf,
  senderOf,
  editRows,
  sendState,
  setSend,
  allLines,
} from "./channels-card-sync-helpers";
import { testDb, withRollback } from "./helpers";

// A decision in any channel edits the other Telegram cards of the send, and an old edit never
// overwrites a newer state. Warsaw is UTC+1 on these dates: 13:05Z is 14:05 local.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

describe("card sync: decisions call the hook once, with the right input", () => {
  test("approve, reject and a refused decision", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: { decision: string; sendId: string; exceptUserId?: string; at: Date }[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      await reject(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW });
      // A second reject changes nothing and calls nothing.
      await reject(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW });
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW })).toEqual({
        kind: "rejected",
      });
      expect(calls).toEqual([{ decision: "rejected", sendId: w.sendId, exceptUserId: w.u1, at: NOW }]);
    });
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: { decision: string; exceptUserId?: string }[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      await approve(depsOf(w, { kind: "all" }, hooks), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(calls).toMatchObject([{ decision: "approved" }]);
      expect(calls[0]?.exceptUserId).toBeUndefined();
    });
  });

  test("a tap on a send past its limit expires it and calls the hook once with the tapper as the exception (F102 stage 18)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await trx
        .updateTable("actions")
        .set({ notified_at: new Date(NOW.getTime() - 49 * HOUR_MS) })
        .where("id", "=", w.sendId)
        .execute();
      const calls: { decision: string; sendId: string; exceptUserId?: string; at: Date }[] = [];
      const spy: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input);
        },
      };
      const real = cardEditHooks({ sendScope: { kind: "all" } });
      const hooks: ApprovalHooks = {
        onDecided: async (t, c, input) => {
          await spy.onDecided(t, c, input);
          await real.onDecided(t, c, input);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u1, via: "telegram", now: NOW })).toEqual({
        kind: "expired",
        byThisTap: true,
      });
      // The second tap finds the send closed: no second hook call.
      expect(await approve(deps, w.ctx, w.sendId, { userId: w.u2, via: "telegram", now: NOW })).toEqual({
        kind: "expired",
        byThisTap: false,
      });
      expect(calls).toEqual([{ decision: "expired", sendId: w.sendId, exceptUserId: w.u1, at: NOW }]);
      // The tapped card is the handler's own edit; the card of the other owner loses its buttons.
      expect((await editRows(w)).map((row) => [row.edit_of_outbox_id, row.dedup_key])).toEqual([
        [w.c2, `approval_edit:${w.c2}:expired`],
      ]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited).toEqual([
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${edits.expired(CLOCK)}`, buttons: [] } },
      ]);
    });
  });

  test("a decision that read its clock earlier but commits later still ends the card (review 9 N1)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      // The approve read the clock at t2 and committed first; its edit goes out. The reject read t1 < t2 and committed after it.
      const t2 = new Date(NOW.getTime() + 2000);
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: t2 });
      const sender = senderOf(w);
      await sender.run(t2);
      expect(sender.channel.edited).toHaveLength(2);
      await reject(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      await sender.run(new Date(t2.getTime() + 1000));
      const rows = await editRows(w);
      expect(rows.filter((row) => row.status === "failed")).toEqual([]);
      // Both cards end with the rejection (the two rows have the same time, so their order is not fixed).
      expect(
        sender.channel.edited
          .slice(2)
          .map((edit) => edit.message.text)
          .sort()
      ).toEqual([`CARD-ONE\n\n${edits.rejected(CLOCK)}`, `CARD-TWO\n\n${edits.rejected(CLOCK)}`]);
    });
  });

  test("a failure of the card sync is logged and the decision stays", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      // A send scope that cannot be read: finding the held cause throws inside the hook, after the approval was written.
      const broken = { kind: "self", addresses: null } as unknown as SendScope;
      const result = await approve(depsOf(w, broken), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(result.kind).toBe("approved");
      expect((await sendState(w)).status).toBe("approved");
      expect(await editRows(w)).toEqual([]);
      expect(allLines().some((line) => line.includes("card_edits_not_queued"))).toBe(true);
      // The transaction is alive: later statements run.
      expect((await sendState(w)).status).toBe("approved");
    });
  });
});

describe("card sync: the checks of the sender", () => {
  async function rowFor(w: World, userId: string, targetId: string, outcome: string, key: string, at = NOW) {
    const id = await insertOutbox(w.trx, w.ctx, {
      userId,
      kind: "approval_edit",
      dedupKey: key,
      emailId: w.emailId,
      editOfOutboxId: targetId,
      view: { original: "CARD", outcome, at: at.toISOString(), timeZone: "Europe/Warsaw" },
      locale: "en",
      createdAt: at,
      nextAttemptAt: at,
    });
    if (id === null) throw new Error("no row");
    return id;
  }

  async function claimed(w: World, id: string) {
    const row = await w.trx
      .selectFrom("outbox")
      .select(["id", "org_id", "user_id", "view", "created_at", "edit_of_outbox_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      view: row.view,
      createdAt: row.created_at,
      editOfOutboxId: row.edit_of_outbox_id,
    };
  }

  test("each outcome needs its state of the send", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const cases: [string, string, string | null, boolean][] = [
        ["approved", "approved", null, true],
        ["approved", "applying", null, true],
        ["approved", "applied", null, true],
        ["approved_held", "approved", null, true],
        ["approved", "rejected", null, false],
        ["approved", "awaiting_approval", null, false],
        ["rejected", "rejected", null, true],
        ["rejected", "approved", null, false],
        ["changed", "expired", "superseded", true],
        ["changed", "expired", "timeout", false],
        ["changed", "rejected", null, false],
        ["expired", "expired", "timeout", true],
        ["expired", "approved", null, false],
      ];
      let n = 0;
      for (const [outcome, status, reason, ok] of cases) {
        n += 1;
        await setSend(w, status, reason);
        const id = await rowFor(w, w.u1, w.c1, outcome, `case:${n}`);
        const result = await checkCardEdit(trx, (await claimed(w, id)) as never);
        expect([outcome, status, reason, result.ok]).toEqual([outcome, status, reason, ok]);
        if (!result.ok) expect(result.code).toBe("stale_edit");
      }
    });
  });

  test("no target: not sent, text removed, another user's card, no pointer", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      const own = await rowFor(w, w.u1, w.c1, "approved", "own");
      expect((await checkCardEdit(trx, (await claimed(w, own)) as never)).ok).toBe(true);
      // The edit row of U1 that points at the card of U2.
      const foreignUser = await rowFor(w, w.u1, w.c2, "approved", "foreign-user");
      expect(await checkCardEdit(trx, (await claimed(w, foreignUser)) as never)).toEqual({
        ok: false,
        code: "no_target",
      });
      // Retention removed the card text.
      await trx.updateTable("outbox").set({ text: "[removed]" }).where("id", "=", w.c2).execute();
      const removed = await rowFor(w, w.u2, w.c2, "approved", "removed");
      expect(await checkCardEdit(trx, (await claimed(w, removed)) as never)).toEqual({ ok: false, code: "no_target" });
      // The card is not `sent` (it failed).
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "blocked", sent_at: null })
        .where("id", "=", w.c1)
        .execute();
      expect(await checkCardEdit(trx, (await claimed(w, own)) as never)).toEqual({ ok: false, code: "no_target" });
    });
  });

  test("a newer edit of the card that went out makes the older row stale", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      const older = await rowFor(w, w.u1, w.c1, "approved", "older", new Date(NOW.getTime() - 1000));
      const newer = await rowFor(w, w.u1, w.c1, "approved_held", "newer", NOW);
      expect((await checkCardEdit(trx, (await claimed(w, older)) as never)).ok).toBe(true);
      await trx.updateTable("outbox").set({ status: "sent", sent_at: NOW }).where("id", "=", newer).execute();
      expect(await checkCardEdit(trx, (await claimed(w, older)) as never)).toEqual({ ok: false, code: "stale_edit" });
      // The newer row itself is not stale because of the older one.
      await trx.updateTable("outbox").set({ status: "sent", sent_at: NOW }).where("id", "=", older).execute();
      expect((await checkCardEdit(trx, (await claimed(w, newer)) as never)).ok).toBe(true);
    });
  });

  test("a card that was sent to a chat before the user linked another chat is not edited", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await setSend(w, "approved");
      // The user links a new chat after the card went out.
      await trx
        .updateTable("chat_links")
        .set({ linked_at: new Date(CARD_AT.getTime() + 1000) })
        .where("user_id", "=", w.u1)
        .execute();
      const id = await rowFor(w, w.u1, w.c1, "approved", "rechat");
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.filter((edit) => edit.chatId === w.chat1)).toEqual([]);
      expect(
        await trx.selectFrom("outbox").select(["status", "error_code"]).where("id", "=", id).executeTakeFirstOrThrow()
      ).toEqual({
        status: "failed",
        error_code: "no_target",
      });
    });
  });
});
