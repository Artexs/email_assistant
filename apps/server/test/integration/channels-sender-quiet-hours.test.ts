import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { createOutboxSender } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDigest } from "../../src/modules/reports";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { type DB } from "../../src/platform/db";

import { captureLogs, T, SECOND, type Tenant, tenant, addRow, rowState, senderFor } from "./channels-sender-helpers";
import { addMember, isolateChannels, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

describe("outbox sender: own quiet hours", () => {
  const LOCAL_2230 = new Date("2026-11-06T21:30:00Z");
  const LOCAL_1200 = new Date("2026-11-06T11:00:00Z");

  async function setHours(trx: Transaction<DB>, t: Tenant, userId: string, start: string | null, end: string | null) {
    await trx
      .updateTable("memberships")
      .set({ quiet_start: start, quiet_end: end })
      .where("org_id", "=", t.ctx.orgId)
      .where("user_id", "=", userId)
      .execute();
  }

  async function flagOn(trx: Transaction<DB>, t: Tenant, enabled = true) {
    await upsertOrgFeature(trx, t.ctx, { flag: "user_quiet_hours", enabled, setBy: t.userId, setAt: T });
  }

  // The owner has the hours 23:00–06:00; a second member has none of their own.
  async function twoMembers(trx: Transaction<DB>) {
    await isolateChannels(trx);
    const t = await tenant(trx);
    const otherId = await addMember(trx, t.ctx.orgId);
    await linkChat(trx, t.ctx, otherId, randomChatId(), T);
    await setHours(trx, t, t.userId, "23:00", "06:00");
    return { t, otherId };
  }

  test("5. at 22:30 the member with 23:00–06:00 gets the urgent row; the member with the default waits until 07:00", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      const own = await addRow(trx, t, { userId: t.userId });
      const other = await addRow(trx, t, { userId: otherId });
      const s = senderFor(trx);
      await s.run(LOCAL_2230);
      expect((await rowState(trx, own)).status).toBe("sent");
      const waiting = await rowState(trx, other);
      expect(waiting.status).toBe("pending");
      expect(waiting.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
      expect(s.channel.sent).toHaveLength(1);
      expect(s.channel.sent[0]?.chatId).toBe(t.chatId);
    });
  });

  test("a row waits until the end of the own hours, not of the default ones (day hours 09:00–17:00)", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      await setHours(trx, t, t.userId, "09:00", "17:00");
      const own = await addRow(trx, t, { userId: t.userId });
      const other = await addRow(trx, t, { userId: otherId });
      const s = senderFor(trx);
      await s.run(LOCAL_1200);
      const held = await rowState(trx, own);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-06T16:00:00.000Z");
      expect((await rowState(trx, other)).status).toBe("sent");
    });
  });

  test("equal start and end: no quiet hours, a notice goes out at 03:00 local", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      await setHours(trx, t, otherId, "10:00", "10:00");
      const night = new Date("2026-11-06T02:00:00Z");
      const earlier = new Date(night.getTime() - HOUR_MS);
      const row = await addRow(trx, t, { userId: otherId, createdAt: earlier, nextAttemptAt: earlier });
      const s = senderFor(trx);
      await s.run(night);
      expect((await rowState(trx, row)).status).toBe("sent");
    });
  });

  test("the flag off: every member has the default hours, own hours are ignored", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t, false);
      const own = await addRow(trx, t, { userId: t.userId });
      const s = senderFor(trx);
      await s.run(LOCAL_2230);
      const held = await rowState(trx, own);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
    });
  });

  test("a digest is not held by the own hours; an own-hours member's row inside them waits", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t);
      const inside = new Date("2026-11-06T22:30:00Z"); // 23:30 local: inside 23:00–06:00
      const digestId = await insertDigest(trx, t.ctx, {
        userId: t.userId,
        slotKey: "2026-11-06T23:30",
        periodStart: T,
        periodEnd: inside,
      });
      if (!digestId) throw new Error("no digest");
      const digest = await addRow(trx, t, { kind: "digest", digestId });
      const urgent = await addRow(trx, t);
      await senderFor(trx).run(inside);
      expect((await rowState(trx, digest)).status).toBe("sent");
      const held = await rowState(trx, urgent);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T05:00:00.000Z");
    });
  });

  test("one query reads the hours of the whole batch, not one per row", async () => {
    await withRollback(db, async (trx) => {
      const { t, otherId } = await twoMembers(trx);
      await flagOn(trx, t);
      for (let i = 0; i < 4; i += 1) await addRow(trx, t, { userId: i % 2 === 0 ? t.userId : otherId });
      let reads = 0;
      const counting = trx.withPlugin({
        transformQuery: ({ node }) => {
          if (node.kind === "SelectQueryNode" && JSON.stringify(node).includes('"quiet_start"')) reads += 1;
          return node;
        },
        transformResult: async ({ result }) => result,
      });
      await createOutboxSender({ db: counting, channel: createFakeChannel(), now: () => LOCAL_2230 }).run();
      expect(reads).toBe(1);
    });
  });

  // Review fix: a hold never ends in the past.
  test("an end time in the New York spring gap: the row waits until the change (07:00Z), not a past time; each tick keeps it", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await trx
        .updateTable("organizations")
        .set({ timezone: "America/New_York" })
        .where("id", "=", t.ctx.orgId)
        .execute();
      await flagOn(trx, t);
      await setHours(trx, t, t.userId, "00:00", "02:00");
      const first = new Date("2026-03-08T06:05:00Z"); // 01:05 EST
      const row = await addRow(trx, t, {
        userId: t.userId,
        createdAt: new Date(first.getTime() - HOUR_MS),
        nextAttemptAt: new Date(first.getTime() - HOUR_MS),
      });
      const s = senderFor(trx);
      for (const minutes of [0, 1, 2]) {
        await s.run(new Date(first.getTime() + minutes * MINUTE_MS));
        const held = await rowState(trx, row);
        expect(held.status).toBe("pending");
        expect(held.next_attempt_at.toISOString()).toBe("2026-03-08T07:00:00.000Z");
      }
      expect(s.channel.sent).toHaveLength(0);
    });
  });

  test("a row is never put back with a time less than one minute ahead", async () => {
    await withRollback(db, async (trx) => {
      const { t } = await twoMembers(trx);
      await flagOn(trx, t);
      // Own hours 23:00–06:00; now is 05:59:30 local (04:59:30Z): the hours end in 30 seconds.
      const now = new Date("2026-11-07T04:59:30Z");
      const row = await addRow(trx, t, {
        userId: t.userId,
        createdAt: new Date(now.getTime() - HOUR_MS),
        nextAttemptAt: new Date(now.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(now);
      const held = await rowState(trx, row);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T05:00:30.000Z");
    });
  });

  // A flag must never leak from one organization to another (the cache is per organization).
  test.each([true, false])(
    "two organizations in one batch, the flag on in the %s one first: each keeps its own flag",
    async (onFirst) => {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const first = await tenant(trx);
        const second = await tenant(trx);
        for (const [t, on] of [
          [first, onFirst],
          [second, !onFirst],
        ] as const) {
          await setHours(trx, t, t.userId, "23:00", "06:00");
          await flagOn(trx, t, on);
        }
        const rowFirst = await addRow(trx, first, {
          createdAt: new Date(LOCAL_2230.getTime() - 3 * SECOND),
          nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        });
        const rowSecond = await addRow(trx, second, {
          createdAt: new Date(LOCAL_2230.getTime() - 2 * SECOND),
          nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        });
        await senderFor(trx).run(LOCAL_2230);
        // 22:30 local: own hours 23:00–06:00 let the row go; the default hours hold it.
        expect((await rowState(trx, rowFirst)).status).toBe(onFirst ? "sent" : "pending");
        expect((await rowState(trx, rowSecond)).status).toBe(onFirst ? "pending" : "sent");
      });
    }
  );

  test("a user in two organizations has the hours of the organization of the row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await tenant(trx);
      const b = await tenant(trx);
      // The user of `a` is a member of `b` too, with other hours; both organizations have the flag on.
      await trx
        .insertInto("memberships")
        .values({ org_id: b.ctx.orgId, user_id: a.userId, role: "assistant" })
        .execute();
      await trx
        .insertInto("chat_links")
        .values({
          org_id: b.ctx.orgId,
          user_id: a.userId,
          channel: "telegram",
          external_chat_id: randomChatId(),
          linked_at: T,
        })
        .execute();
      await flagOn(trx, a);
      await flagOn(trx, b);
      await setHours(trx, a, a.userId, "23:00", "06:00");
      await setHours(trx, b, a.userId, "08:00", "09:00");
      const rowA = await addRow(trx, a, {
        userId: a.userId,
        createdAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
        nextAttemptAt: new Date(LOCAL_2230.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(LOCAL_2230);
      // Hours of `a` (23:00–06:00) at 22:30: not quiet. The hours of `b` (08:00–09:00) would not hold it either, so use 23:30.
      expect((await rowState(trx, rowA)).status).toBe("sent");
      const later = new Date("2026-11-06T22:30:00Z"); // 23:30 local
      const rowA2 = await addRow(trx, a, {
        userId: a.userId,
        createdAt: new Date(later.getTime() - HOUR_MS),
        nextAttemptAt: new Date(later.getTime() - HOUR_MS),
      });
      await senderFor(trx).run(later);
      // Inside the hours of `a`: held, whatever the hours of `b` say.
      expect((await rowState(trx, rowA2)).status).toBe("pending");
    });
  });
});
