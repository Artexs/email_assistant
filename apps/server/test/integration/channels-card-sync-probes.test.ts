import { encodeCallback, textTables, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { approve, type ApprovalHooks, type SendScope } from "../../src/modules/actions";
import { cardEditHooks, detectNotices, handleCallback } from "../../src/modules/channels";
import { getEditTarget, newerEditSent } from "../../src/modules/channels/card-edits-repo";
import { replaceChatLink } from "../../src/modules/channels/repo";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { type DB } from "../../src/platform/db";

import {
  captureLogs,
  LINKED,
  CARD_AT,
  NOW,
  edits,
  CLOCK,
  type World,
  insertCard,
  world,
  depsOf,
  tapDeps,
  linkOf,
  senderOf,
  editRows,
  sendState,
  allLines,
} from "./channels-card-sync-helpers";
import { createOrgWithMailbox, insertDraftAndSend, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// A decision in any channel edits the other Telegram cards of the send, and an old edit never
// overwrites a newer state. Warsaw is UTC+1 on these dates: 13:05Z is 14:05 local.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

describe("card sync: a second organization", () => {
  test("the readers and the writer stay inside the organization of the call", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const bOrg = await createOrgWithMailbox(trx);
      const ctxB = { orgId: bOrg.orgId };
      // Organization B: its own send and card for its owner.
      const b = await insertDraftAndSend(trx, ctxB, bOrg.mailboxId, { notifiedAt: CARD_AT, createdAt: CARD_AT });
      const cardB = await insertCard(
        trx,
        { orgId: bOrg.orgId, emailId: b.emailId, sendId: b.sendId },
        bOrg.userId,
        700,
        "CARD-B"
      );
      await linkChat(trx, ctxB, bOrg.userId, randomChatId(), LINKED);

      // A decision in A edits no card of B and queues no row for B.
      await approve(depsOf(a), a.ctx, a.sendId, { userId: a.u1, via: "web", now: NOW });
      const rowsOfB = await trx
        .selectFrom("outbox")
        .select("id")
        .where("org_id", "=", bOrg.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rowsOfB).toEqual([]);
      expect((await editRows(a)).length).toBe(2);

      // The readers: a card and a sent edit of A are not visible with the context of B (and the other way round).
      expect(await getEditTarget(trx, ctxB, { targetId: a.c1, userId: a.u1 })).toBeUndefined();
      expect(await getEditTarget(trx, a.ctx, { targetId: cardB, userId: bOrg.userId })).toBeUndefined();
      expect((await getEditTarget(trx, a.ctx, { targetId: a.c1, userId: a.u1 }))?.messageId).toBe(501);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: NOW })
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", a.orgId)
        .execute();
      const first = (await editRows(a))[0];
      if (first === undefined) throw new Error("no edit row");
      const probe = {
        id: "00000000-0000-4000-8000-000000000001",
        targetId: first.edit_of_outbox_id ?? "",
        createdAt: new Date(0),
      };
      expect(await newerEditSent(trx, a.ctx, probe)).toBe(true);
      expect(await newerEditSent(trx, ctxB, probe)).toBe(false);

      // The sender run edits the cards of A only.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", sent_at: null })
        .where("kind", "=", "approval_edit")
        .where("org_id", "=", a.orgId)
        .execute();
      const sender = senderOf(a);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId).sort()).toEqual([501, 502]);
      // The card of B has its text and message id unchanged.
      expect(
        await trx
          .selectFrom("outbox")
          .select(["text", "external_message_id"])
          .where("id", "=", cardB)
          .executeTakeFirstOrThrow()
      ).toEqual({ text: "CARD-B", external_message_id: "700" });
    });
  });
});

describe("approval cards: version and panel link (T9, T10)", () => {
  const BASE = "https://ea.example.ts.net/";
  const t = textTables.en.approvals;

  async function notify(w: World, webBaseUrl?: string) {
    await detectNotices({
      db: w.trx,
      now: () => CARD_AT,
      startedAt: new Date(CARD_AT.getTime() - HOUR_MS),
      testMail: NO_TEST_SENDERS,
      ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
    });
    const sender = senderOf(w);
    await sender.run(CARD_AT);
    return sender.channel.sent.filter((sent) => sent.message.text.includes(t.sendLine));
  }

  async function waitingWorld(trx: Transaction<DB>): Promise<World> {
    const w = await world(trx);
    // The cards of `world` stand for a sent request; this test wants a fresh send with no card.
    await trx.deleteFrom("outbox").where("org_id", "=", w.orgId).execute();
    await trx.updateTable("actions").set({ notified_at: null }).where("id", "=", w.sendId).execute();
    return w;
  }

  test("T9: the link needs the flag and the base URL; no double slash", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      // Flag off: no link, even with a base URL.
      expect((await notify(w, BASE))[0]?.message.text).not.toContain(t.panelLine(""));
      expect((await notify(w, BASE)).length).toBe(0);
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      const cards = await notify(w, BASE);
      expect(cards.length).toBe(2);
      for (const card of cards) {
        expect(card.message.text).toContain(t.panelLine(`https://ea.example.ts.net/approvals?id=${w.sendId}`));
      }
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      // The base URL is empty: no link.
      const cards = await notify(w, undefined);
      expect(cards.length).toBe(2);
      for (const card of cards) expect(card.message.text).not.toContain("approvals?id=");
    });
  });

  test("T9b: a base URL that the view refuses leaves the link out; the card still goes out", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await setOrgFeature(trx, w.ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: CARD_AT });
      const cards = await notify(w, "https://ea.example.test/a\nb");
      expect(cards.length).toBe(2);
      for (const card of cards) expect(card.message.text).not.toContain("approvals?id=");
    });
  });

  test("T10: version 2 says so; version 1 does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      const v1 = await notify(w);
      expect(v1.length).toBe(2);
      for (const card of v1) expect(card.message.text).not.toContain(t.versionLine(1));
      for (const card of v1) expect(card.message.text).not.toContain("✏️ Version");
    });
    await withRollback(db, async (trx) => {
      const w = await waitingWorld(trx);
      await trx
        .updateTable("actions")
        .set((eb) => ({
          payload: eb.fn("jsonb_set", [eb.ref("payload"), eb.val("{version}"), eb.val("2"), eb.val(true)]),
        }))
        .where("type", "=", "create_draft")
        .where("email_id", "=", w.emailId)
        .execute();
      const v2 = await notify(w);
      expect(v2.length).toBe(2);
      for (const card of v2) expect(card.message.text).toContain(t.versionLine(2));
    });
  });
});

describe("card sync: review probes", () => {
  test("a real Postgres error inside the hook: the savepoint keeps the decision and the transaction alive", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const real = cardEditHooks({ sendScope: { kind: "all" } });
      // An invalid uuid makes `heldReason` raise 22P02 in a statement, inside the savepoint of the hook.
      const broken: ApprovalHooks = {
        onDecided: (t, c, input) => real.onDecided(t, c, { ...input, sendId: "not-a-uuid" }),
      };
      const result = await approve(depsOf(w, { kind: "all" }, broken), w.ctx, w.sendId, {
        userId: w.u1,
        via: "web",
        now: NOW,
      });
      expect(result.kind).toBe("approved");
      expect((await sendState(w)).status).toBe("approved");
      expect(await editRows(w)).toEqual([]);
      const line = allLines().find((entry) => entry.includes("card_edits_not_queued"));
      expect(line).toBeDefined();
      const fields = JSON.parse(line ?? "{}") as Record<string, unknown>;
      // The test id is not a uuid, so the logger drops the `action_id` field: ids and codes only.
      expect(fields.error_code).toBe("22P02");
      expect(Object.keys(fields).sort()).toEqual(
        ["dropped_fields", "error", "error_code", "event", "kind", "level", "module", "msg", "time"].sort()
      );
      const audit = await trx
        .selectFrom("audit_log")
        .select("event")
        .where("org_id", "=", w.orgId)
        .where("action_id", "=", w.sendId)
        .execute();
      expect(audit.map((row) => row.event)).toContain("action.approved");
      expect((await sql<{ x: number }>`select 1 as x`.execute(trx)).rows[0]?.x).toBe(1);
    });
  });

  test("a held Telegram approval with two owners: the tap edits C1, one row for C2, no card edited twice", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const off: SendScope = { kind: "off" };
      const reject = [
        [
          {
            text: textTables.en.approvals.buttons.reject,
            data: encodeCallback({ kind: "reject", actionId: w.sendId }),
          },
        ],
      ];
      const held = edits.approvedHeld(CLOCK, textTables.en.approvals.held.scope);
      const tap = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u1),
        encodeCallback({ kind: "approve", actionId: w.sendId })
      );
      expect(tap.edit?.text).toBe(`CARD-ONE\n\n${held}`);
      const rows = await trx
        .selectFrom("outbox")
        .select(["edit_of_outbox_id", "dedup_key", "view", "user_id"])
        .where("org_id", "=", w.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rows.map((row) => [row.edit_of_outbox_id, row.user_id, row.dedup_key])).toEqual([
        [w.c2, w.u2, `approval_edit:${w.c2}:approved_held`],
      ]);
      expect(rows[0]?.view).toMatchObject({ outcome: "approved_held", heldBy: "scope", actionId: w.sendId });
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited).toEqual([
        { chatId: w.chat2, messageId: 502, message: { text: `CARD-TWO\n\n${held}`, buttons: reject } },
      ]);
      // U2 taps Reject on C2: the tap edits C2, the outbox edits C1 only.
      const tap2 = await handleCallback(
        tapDeps(w, off),
        linkOf(w, w.u2),
        encodeCallback({ kind: "reject", actionId: w.sendId })
      );
      expect(tap2.edit?.text).toBe(`CARD-TWO\n\n${edits.rejected(CLOCK)}`);
      await sender.run();
      expect(sender.channel.edited.slice(1)).toEqual([
        { chatId: w.chat1, messageId: 501, message: { text: `CARD-ONE\n\n${edits.rejected(CLOCK)}`, buttons: [] } },
      ]);
    });
  });

  test("queue side: a card whose text retention removed gets no edit row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await trx
        .updateTable("outbox")
        .set({ text: "[removed]", view: JSON.stringify({}) })
        .where("id", "=", w.c2)
        .execute();
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      expect((await editRows(w)).map((row) => row.edit_of_outbox_id)).toEqual([w.c1]);
      const sender = senderOf(w);
      await sender.run();
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([501]);
      expect(JSON.stringify(sender.channel.edited)).not.toContain("[removed]");
    });
  });

  test("a re-link of the same chat after the card went out drops the edit as no_target", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await replaceChatLink(trx, w.ctx, {
        userId: w.u2,
        chatId: w.chat2,
        linkedAt: new Date(CARD_AT.getTime() + MINUTE_MS),
      });
      await approve(depsOf(w), w.ctx, w.sendId, { userId: w.u1, via: "web", now: NOW });
      const sender = senderOf(w);
      await sender.run();
      const rows = await editRows(w);
      expect(rows.find((row) => row.edit_of_outbox_id === w.c2)).toMatchObject({
        status: "failed",
        error_code: "no_target",
      });
      expect(sender.channel.edited.map((edit) => edit.messageId)).toEqual([501]);
    });
  });

  test("a card of another organization with the dedup key of this send gets no row", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const bOrg = await createOrgWithMailbox(trx);
      const b = await insertDraftAndSend(trx, { orgId: bOrg.orgId }, bOrg.mailboxId, {
        notifiedAt: CARD_AT,
        createdAt: CARD_AT,
      });
      // Only possible by hand: a reader without the org filter would pick this card up.
      await insertCard(trx, { orgId: bOrg.orgId, emailId: b.emailId, sendId: a.sendId }, bOrg.userId, 777, "CARD-B");
      await approve(depsOf(a), a.ctx, a.sendId, { userId: a.u1, via: "web", now: NOW });
      expect((await editRows(a)).length).toBe(2);
      const rowsB = await trx
        .selectFrom("outbox")
        .select("id")
        .where("org_id", "=", bOrg.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(rowsB).toEqual([]);
      expect(allLines().some((entry) => entry.includes("card_edits_not_queued"))).toBe(false);
    });
  });
});
