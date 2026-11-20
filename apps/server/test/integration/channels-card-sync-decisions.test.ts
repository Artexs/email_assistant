import { encodeCallback, textTables, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { approve, editApproval, type ApprovalHooks, type SendScope } from "../../src/modules/actions";
import { ChannelError, handleCallback, insertOutbox } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";

import {
  captureLogs,
  CARD_AT,
  NOW,
  edits,
  CLOCK,
  world,
  depsOf,
  tapDeps,
  linkOf,
  senderOf,
  editRows,
  sendState,
  setSend,
  byMessage,
  allLines,
} from "./channels-card-sync-helpers";
import { insertTestEmail, testNoticeView } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// A decision in any channel edits the other Telegram cards of the send, and an old edit never
// overwrites a newer state. Warsaw is UTC+1 on these dates: 13:05Z is 14:05 local.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

describe("card sync: a decision edits the other cards (T1-T3)", () => {
  test("T1: a panel approval edits both cards with their message ids and no buttons", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const result = await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect(result.kind).toBe("approved");
      expect((await editRows(w)).map((row) => row.status)).toEqual(["pending", "pending"]);

      const sender = senderOf(w);
      await sender.run();

      expect(sender.channel.sent).toEqual([]);
      expect(byMessage(sender.channel.edited)).toEqual([
        { chatId: w.chat1, messageId: 501, message: { text: `CARD-ONE\n\n${edits.approved(CLOCK)}`, buttons: [] } },
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${edits.approved(CLOCK)}`, buttons: [] } },
      ]);
      expect(edits.approved(CLOCK)).toBe("⏳ Approved 14:05, sending.");
      const rows = await editRows(w);
      expect(rows.map((row) => row.status)).toEqual(["sent", "sent"]);
      const ids = await trx
        .selectFrom("outbox")
        .select(["edit_of_outbox_id", "external_message_id"])
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", w.orgId)
        .execute();
      expect(ids.map((row) => [row.edit_of_outbox_id, Number(row.external_message_id)]).sort()).toEqual(
        [
          [w.c1, 501],
          [w.c2, 502],
        ].sort()
      );
      // A second run edits nothing more.
      await sender.run();
      expect(sender.channel.edited).toHaveLength(2);
    });
  });

  test("T2: a Telegram approval by U1 edits C2 only (the tap edits its own card)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const tap = await handleCallback(
        tapDeps(w),
        linkOf(w, w.u1),
        encodeCallback({ kind: "approve", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${edits.approved(CLOCK)}`);

      const rows = await editRows(w);
      expect(rows.map((row) => row.edit_of_outbox_id)).toEqual([w.c2]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.map((edit) => [edit.chatId, edit.messageId])).toEqual([[w.chat2, 502]]);
    });
  });

  test("T3: with SEND_SCOPE off the cards show approved_held and C2 keeps the Reject button", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      await sender.run();
      const reject = [
        [
          {
            text: textTables.en.approvals.buttons.reject,
            data: encodeCallback({ kind: "reject", actionId: w.sendId }),
          },
        ],
      ];
      const held = edits.approvedHeld(CLOCK, textTables.en.approvals.held.scope);
      expect(byMessage(sender.channel.edited).map((edit) => edit.message)).toEqual([
        { text: `CARD-ONE\n\n${held}`, buttons: reject },
        { text: `CARD-TWO\n\n${held}`, buttons: reject },
      ]);
    });
  });
});

describe("card sync: an old edit never overwrites a newer state (T4)", () => {
  test("T4: U1 approves a held send in the panel, then taps Reject on C1", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      // U1 has one notice that takes the one place of U1 in the first run: the C1 edit waits (rate limit).
      const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
      await insertOutbox(trx, w.ctx, {
        userId: w.u1,
        kind: "urgent",
        dedupKey: "urgent:t4",
        emailId,
        view: testNoticeView("urgent", { marker: "m", emailId, at: CARD_AT }),
        locale: "en",
        createdAt: CARD_AT,
        nextAttemptAt: CARD_AT,
      });
      await approve(depsOf(w, off), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w, createFakeChannel(), 1);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([502]);
      const waiting = (await editRows(w)).find((row) => row.edit_of_outbox_id === w.c1);
      expect(waiting?.status).toBe("pending");

      // U1 taps Reject on C1: the send is rejected; C2 gets the rejected edit; the tap edits C1 itself.
      const tap = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u1),
        encodeCallback({ kind: "reject", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${edits.rejected(CLOCK)}`);
      await sender.run();

      const rows = await editRows(w);
      const c1Row = rows.find((row) => row.edit_of_outbox_id === w.c1);
      expect(c1Row).toMatchObject({ status: "failed", error_code: "stale_edit" });
      // C1 is never edited by the outbox; C2 shows the rejection at the end.
      expect(sender.channel.edited.filter((edit) => edit.messageId === 501)).toEqual([]);
      expect(sender.channel.edited.at(-1)).toEqual({
        chatId: w.chat2,
        messageId: 502,
        message: { text: `CARD-TWO\n\n${edits.rejected(CLOCK)}`, buttons: [] },
      });
      expect((await sendState(w)).status).toBe("rejected");
    });
  });
});

describe("card sync: the sender (T5, T6)", () => {
  test("T5: in the quiet hours an edit goes out in the same run; an urgent row of U1 waits", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
      const urgent = await insertOutbox(trx, w.ctx, {
        userId: w.u1,
        kind: "urgent",
        dedupKey: "urgent:t5",
        emailId,
        view: testNoticeView("urgent", { marker: "m", emailId, at: CARD_AT }),
        locale: "en",
        createdAt: CARD_AT,
        nextAttemptAt: CARD_AT,
      });
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u2, via: "web", now: NOW });
      const sender = senderOf(w);
      const late = new Date("2026-11-20T22:30:00Z");
      await sender.run(late);
      expect(sender.channel.edited.map((edit) => edit.messageId).sort()).toEqual([501, 502]);
      expect(sender.channel.sent).toEqual([]);
      const state = await trx
        .selectFrom("outbox")
        .select(["status", "next_attempt_at"])
        .where("id", "=", urgent ?? "")
        .executeTakeFirstOrThrow();
      expect(state.status).toBe("pending");
      expect(state.next_attempt_at.getTime()).toBeGreaterThan(late.getTime());
    });
  });

  test("T6: a refused edit ends failed / edit_failed and is not taken again; a soft error backs off", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      sender.channel.failWith(new ChannelError("bad_request", "message_not_found"), 1);
      await sender.run();
      let rows = await editRows(w);
      expect(rows.map((row) => [row.status, row.error_code])).toEqual([
        ["failed", "edit_failed"],
        ["sent", null],
      ]);
      // The decision stays: Telegram never rolls it back.
      expect((await sendState(w)).status).toBe("approved");
      await sender.run(new Date(NOW.getTime() + MINUTE_MS));
      expect(sender.channel.edited).toHaveLength(1);

      // A soft error releases the row with a backoff, without a failure.
      const w2 = await world(trx);
      await approve(depsOf(w2), w2.ctx, w2.sendId, { userId: w2.u1, via: "web", now: NOW });
      const soft = senderOf(w2);
      soft.channel.failWith(new ChannelError("soft", "network"), 1);
      await soft.run();
      rows = await editRows(w2);
      expect(rows.map((row) => row.status)).toEqual(["pending", "pending"]);
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(NOW.getTime());
      // No log line holds the card text.
      expect(allLines().some((line) => line.includes("CARD-"))).toBe(false);
    });
  });

  test("the edit of a blocked bot fails as edit_failed too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      sender.channel.failWith(new ChannelError("blocked", "bot_blocked"), 2);
      await sender.run();
      expect((await editRows(w)).map((row) => [row.status, row.error_code])).toEqual([
        ["failed", "edit_failed"],
        ["failed", "edit_failed"],
      ]);
    });
  });
});

describe("card sync: an edit of a send (T7, T8)", () => {
  test("T7: a panel edit of S1 ends both cards with the changed line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const result = await editApproval(depsOf(w), w.ctx, w.sendId, {
        userId: w.u1,
        via: "web",
        now: NOW,
        subject: "Budget 2027",
        body: "Hello Anna,\nplease send the report.",
      });
      expect(result.kind).toBe("edited");
      const sender = senderOf(w);
      await sender.run();
      expect(byMessage(sender.channel.edited).map((edit) => edit.message)).toEqual([
        { text: `CARD-ONE\n\n${edits.changed(CLOCK)}`, buttons: [] },
        { text: `CARD-TWO\n\n${edits.changed(CLOCK)}`, buttons: [] },
      ]);
      expect(edits.changed(CLOCK)).toStartWith("✏️ Changed 14:05.");
    });
  });

  test("T8: a refused edit calls no hook", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const calls: string[] = [];
      const hooks: ApprovalHooks = {
        onDecided: async (_trx, _ctx, input) => {
          calls.push(input.decision);
        },
      };
      const deps = depsOf(w, { kind: "all" }, hooks);
      const input = { userId: w.u1, via: "web" as const, now: NOW, subject: "S", body: "B" };
      // closed: an approved send; unknown id.
      await setSend(w, "approved");
      expect((await editApproval(deps, w.ctx, w.sendId, input)).kind).toBe("closed");
      expect((await editApproval(deps, w.ctx, "00000000-0000-4000-8000-000000000000", input)).kind).toBe("not_found");
      expect(calls).toEqual([]);
      await setSend(w, "awaiting_approval");
      await trx
        .updateTable("actions")
        .set({ approved_by: null, approved_at: null, approved_via: null })
        .where("id", "=", w.sendId)
        .execute();
      expect((await editApproval(deps, w.ctx, w.sendId, input)).kind).toBe("edited");
      expect(calls).toEqual(["changed"]);
    });
  });
});
