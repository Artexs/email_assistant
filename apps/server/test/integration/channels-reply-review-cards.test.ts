import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { noDelegationHooks } from "../../src/modules/actions";
import { createOutboxSender, handleCallback, type CallbackDeps } from "../../src/modules/channels";
import { listCardsOfSend, getEditTarget } from "../../src/modules/channels/card-edits-repo";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { cancelPendingApprovalRequestsOfClosedSends } from "../../src/modules/channels/repo/cancel";

import { at, cards, keysOf, T, team, threeReplies } from "./channels-reply-review-helpers";
import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { sweepReply } from "./reply-answered-fixtures";

// The review cards of the reply drafts in Telegram.
const db = testDb();

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let errorLines: string[] = [];

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

afterAll(async () => {
  await db.destroy();
});

describe("the review cards and the F102 card sync", () => {
  test("10. listCardsOfSend finds the plain card and the review cards of a send; getEditTarget names the send; a pending review card of a closed send fails", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first, second] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "77", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "78", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      await handleCallback(o.deps, o.owner, "rv");
      const all = await cards(trx, o);
      expect(all.map((row) => row.dedup_key)).toContain(`approval:${first?.sendId}:r2`);

      const found = await listCardsOfSend(trx, o.ctx, first?.sendId as string);
      expect(found.map((card) => card.id).sort()).toEqual(
        all
          .filter((row) => row.dedup_key.startsWith(`approval:${first?.sendId}`))
          .map((row) => row.id)
          .sort()
      );
      expect(found).toHaveLength(2);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "79", sent_at: at(MINUTE_MS), text: "card text" })
        .where("kind", "=", "approval")
        .execute();
      for (const card of all.filter((row) => row.dedup_key.startsWith(`approval:${first?.sendId}`))) {
        const target = await getEditTarget(trx, o.ctx, { targetId: card.id, userId: o.userId });
        expect(target?.sendId).toBe(first?.sendId);
      }
      // A card of another send is not found.
      expect((await listCardsOfSend(trx, o.ctx, second?.sendId as string)).map((card) => card.id)).not.toContain(
        found[0]?.id
      );

      // A review card that no sender took, of a send that still waits, stays as it is.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", external_message_id: null, sent_at: null })
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .execute();
      expect(await cancelPendingApprovalRequestsOfClosedSends(trx, o.ctx, { staleBefore: at(-HOUR_MS) })).toBe(0);
      // A review card that no sender took, of a send that is closed now: `failed` / `outdated`.
      await trx
        .updateTable("outbox")
        .set({ status: "pending", external_message_id: null, sent_at: null })
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "rejected" })
        .where("id", "=", first?.sendId as string)
        .execute();
      const cancelled = await cancelPendingApprovalRequestsOfClosedSends(trx, o.ctx, { staleBefore: at(-HOUR_MS) });
      expect(cancelled).toBeGreaterThanOrEqual(1);
      const row = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("dedup_key", "=", `approval:${first?.sendId}:r2`)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "failed", error_code: "outdated" });
    });
  });

  test("11. a decision on the send in the panel edits the sent review card of the owner (card sync finds the key r<n>)", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      await trx
        .updateTable("outbox")
        .set({ status: "sent", external_message_id: "91", sent_at: at(MINUTE_MS), text: "✍️ Reply card" })
        .where("kind", "=", "approval")
        .execute();
      const { reject } = await import("../../src/modules/actions");

      await reject(
        {
          db: trx,
          hooks: noDelegationHooks,
          approvalHooks: (await import("../../src/modules/channels/card-edits")).cardEditHooks({
            sendScope: { kind: "all" },
          }),
          uidplus: async () => true,
        } as never,
        o.ctx,
        first?.sendId as string,
        { userId: o.userId, via: "web", now: T }
      );

      const edits = await trx
        .selectFrom("outbox")
        .selectAll()
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(edits).toHaveLength(1);
      expect(edits[0]?.dedup_key).toMatch(/^approval_edit:[0-9a-f-]{36}:rejected$/);
    });
  });

  test("12. a tap on the sent review card edits that card (the tap names its message), not another card of the send", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const [first] = await threeReplies(trx, o);
      await handleCallback(o.deps, o.owner, "rv");
      const sendCard = (key: string, messageId: string, text: string) =>
        trx
          .updateTable("outbox")
          .set({ status: "sent", external_message_id: messageId, sent_at: at(MINUTE_MS), text })
          .where("dedup_key", "=", key)
          .execute();
      await sendCard(`approval:${first?.sendId}:r1`, "91", "✍️ Reply card one");
      // The owner skipped it and asked for the review again: the same send has a second card.
      await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`);
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "outdated" })
        .where("dedup_key", "like", "approval:%:r1")
        .where("status", "=", "pending")
        .execute();
      await handleCallback(o.deps, o.owner, "rv");
      await sendCard(`approval:${first?.sendId}:r2`, "92", "✍️ Reply card two");

      const skipped = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`, { messageId: 91 });

      expect(skipped.edit).toEqual({
        text: "✍️ Reply card one\n\n⏭ Skipped 11:00. The draft stays in the panel.",
        buttons: [],
      });
      const other = await handleCallback(o.deps, o.owner, `rk:${first?.sendId}`, { messageId: 92 });
      expect(other.edit?.text).toStartWith("✍️ Reply card two");
    });
  });
});

describe("the sender: review cards are not held in quiet hours", () => {
  test("13. a review card goes out at 23:00 org time; a replies_ready row of the same hour waits", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const night = new Date("2026-11-20T22:00:00Z");
      const [first] = await threeReplies(trx, o);
      const ready = await trx
        .insertInto("outbox")
        .values({
          org_id: o.ctx.orgId,
          user_id: o.userId,
          kind: "replies_ready",
          dedup_key: `replies_ready:${o.userId}:${first?.sendId}`,
          view: JSON.stringify({ count: 3, now: night.toISOString(), timeZone: "Europe/Warsaw", review: true }),
          locale: "en",
          status: "pending",
          attempts: 0,
          created_at: night,
          next_attempt_at: night,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const nightDeps: CallbackDeps = { ...o.deps, now: () => night };
      await handleCallback(nightDeps, o.owner, "rv");
      const channel = createFakeChannel();

      await createOutboxSender({ db: trx, channel, now: () => night }).run();

      const states = await trx
        .selectFrom("outbox")
        .select(["id", "kind", "status"])
        .where("org_id", "=", o.ctx.orgId)
        .where("kind", "in", ["approval", "replies_ready"])
        .execute();
      expect(states.find((row) => row.kind === "approval")?.status).toBe("sent");
      expect(states.find((row) => row.id === ready.id)?.status).toBe("pending");
      expect(channel.sent.filter((sent) => sent.message.text.includes("Reply to"))).toHaveLength(1);
    });
  });
});

describe("review repair: other kinds, refused cards, plain cards in quiet hours", () => {
  test("TG1. a clarification send next to replies is not shown as a review card and is not a reply to skip to", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const clarification = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-4 * HOUR_MS),
      });
      const [reply] = await threeReplies(trx, o);

      await handleCallback(o.deps, o.owner, "rv");

      expect(await keysOf(trx, o)).toEqual([`approval:${reply?.sendId}:r1`]);
      const next = await handleCallback(o.deps, o.owner, `rv:${clarification.sendId}`);
      expect(next).toEqual({ answer: "" });
      expect((await keysOf(trx, o)).every((key) => !key.includes(clarification.sendId))).toBe(true);
    });
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-HOUR_MS),
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result.send).toEqual({ text: "No more replies waiting.", buttons: [] });
      expect(await cards(trx, o)).toHaveLength(0);
    });
  });

  test("TG3. Skip on a send that is not a reply does nothing: not found, no card, the send is unchanged", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const delegation = await insertDraftAndSend(trx, o.ctx, o.mailboxId, { createdAt: at(-2 * HOUR_MS) });
      await threeReplies(trx, o);

      const result = await handleCallback(o.deps, o.owner, `rk:${delegation.sendId}`);

      expect(result).toEqual({ answer: "This mail is not in your account." });
      expect(await cards(trx, o)).toHaveLength(0);
      const send = await trx
        .selectFrom("actions")
        .select(["status", "notified_at"])
        .where("id", "=", delegation.sendId)
        .executeTakeFirstOrThrow();
      expect(send).toMatchObject({ status: "awaiting_approval", notified_at: null });
    });
  });

  // Ten Cc addresses that together do not fit one message (the recipients of a card are never cut).
  const longCc = Array.from(
    { length: 10 },
    (_, index) => `${"a".repeat(60)}${index}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.test`
  );

  test("N6. a card that the renderer refuses is skipped: the next reply shows, nothing is marked, the log holds the id only", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const bad = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-3 * HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        cc: longCc,
      });
      const good = await sweepReply(trx, o, { createdAt: at(-2 * HOUR_MS) });
      const lines: string[] = [];
      logSpy.mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result).toEqual({ answer: "" });
      expect(await keysOf(trx, o)).toEqual([`approval:${good.sendId}:r1`]);
      const row = await trx
        .selectFrom("actions")
        .select(["status", "notified_at"])
        .where("id", "=", bad.sendId)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "awaiting_approval", notified_at: null });
      const warn = [...lines, ...errorLines].filter((line) => line.includes("notice_skipped"));
      expect(warn).toHaveLength(1);
      expect(warn[0]).toContain(`item_id=${bad.sendId}`);
      expect([...lines, ...errorLines].join("\n")).not.toContain("aaaaaaaaaa");
    });
    // Only a refused card: "no more replies", and still nothing is marked.
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const bad = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "reply",
        createdAt: at(-3 * HOUR_MS),
        from: "boss@x.test",
        to: "boss@x.test",
        cc: longCc,
      });

      const result = await handleCallback(o.deps, o.owner, "rv");

      expect(result.send).toEqual({ text: "No more replies waiting.", buttons: [] });
      expect(await cards(trx, o)).toHaveLength(0);
      const row = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", bad.sendId)
        .executeTakeFirstOrThrow();
      expect(row.notified_at).toBeNull();
    });
  });

  test("TG2. a plain approval card (`approval:<send>`) is held in quiet hours; only a review card (`:r<n>`) goes out", async () => {
    await withRollback(db, async (trx) => {
      const o = await team(trx);
      const night = new Date("2026-11-20T22:00:00Z");
      const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        createdAt: at(-HOUR_MS),
      });
      const view = {
        actionId: pair.sendId,
        now: night.toISOString(),
        timeZone: "Europe/Warsaw",
        view: {
          kind: "clarification",
          recipient: { name: null, address: "boss@x.test" },
          sender: null,
          recipientInactive: false,
          subject: "Re: x",
          dueDate: null,
          body: "Hello",
          quote: null,
          synthetic: false,
        },
      };
      await trx
        .insertInto("outbox")
        .values({
          org_id: o.ctx.orgId,
          user_id: o.userId,
          kind: "approval",
          dedup_key: `approval:${pair.sendId}`,
          email_id: pair.emailId,
          view: JSON.stringify(view),
          locale: "en",
          status: "pending",
          attempts: 0,
          created_at: night,
          next_attempt_at: night,
        })
        .execute();
      const channel = createFakeChannel();

      await createOutboxSender({ db: trx, channel, now: () => night }).run();

      const row = await trx
        .selectFrom("outbox")
        .select(["status", "next_attempt_at"])
        .where("dedup_key", "=", `approval:${pair.sendId}`)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("pending");
      expect(row.next_attempt_at.toISOString()).toBe("2026-11-21T06:00:00.000Z");
    });
  });
});
