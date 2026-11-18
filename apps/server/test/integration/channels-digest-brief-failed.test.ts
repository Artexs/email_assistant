// A digest that ends `failed` gives its marks back; the day of a late slot is the date of the slot.
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createOutboxSender } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { digestTexts, EIGHT, loopRow, ready, runDigests, SIXTEEN, waitingLoop } from "./channels-digest-brief-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const stale = (trx: Transaction<DB>, org: Awaited<ReturnType<typeof ready>>) =>
  insertLoopRow(trx, org.ctx, org.mailboxId, {
    status: "closed",
    close_reason: "stale",
    closed_at: new Date("2026-11-19T10:00:00Z"),
    subject: "STALE-SUBJECT",
    due_at: new Date("2026-10-01T10:00:00Z"),
  });

describe("N4 a failed digest gives its marks back", () => {
  test("the chat is gone: the row ends failed, the marks go back and the next digest of the day has the brief and the ⌛ line again", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loopId = await waitingLoop(trx, org);
      const staleId = await stale(trx, org);
      await runDigests(trx, EIGHT);
      expect((await loopRow(trx, loopId)).surfaced_at).not.toBeNull();
      expect((await loopRow(trx, staleId)).stale_notified_at).not.toBeNull();
      // The sender finds no chat for the user and fails the row (`no_chat`).
      await trx.deleteFrom("chat_links").where("org_id", "=", org.ctx.orgId).execute();
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => new Date(EIGHT) }).run();
      expect(channel.sent).toEqual([]);
      const row = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("org_id", "=", org.ctx.orgId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "failed", error_code: "no_chat" });
      expect((await loopRow(trx, loopId)).surfaced_at).toBeNull();
      expect((await loopRow(trx, staleId)).stale_notified_at).toBeNull();
      // The user links the chat again; the 16:00 slot is the first digest that reaches the chat: it names both loops.
      await trx
        .insertInto("chat_links")
        .values({
          org_id: org.ctx.orgId,
          user_id: org.userId,
          channel: "telegram",
          external_chat_id: org.chatId,
          linked_at: new Date("2026-11-05T20:00:00Z"),
        })
        .execute();
      await runDigests(trx, SIXTEEN);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts).toHaveLength(2);
      expect(texts[1]).toContain("NEEDS YOU TODAY");
      expect(texts[1]).toContain("⌛ Closed without an answer: STALE-SUBJECT");
      expect((await loopRow(trx, staleId)).stale_notified_at).toEqual(new Date(SIXTEEN));
    });
  });

  test("a digest that was delivered keeps its marks; a failed digest that names the same loop does not take them back", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const staleId = await stale(trx, org);
      await runDigests(trx, EIGHT);
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => new Date(EIGHT) }).run();
      expect(channel.sent).toHaveLength(1);
      const marked = (await loopRow(trx, staleId)).stale_notified_at;
      expect(marked).toEqual(new Date(EIGHT));
      // A second digest names the loop too (a test row with the same view); its failure leaves the mark of the delivered one.
      const [delivered] = await trx.selectFrom("outbox").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      const copyDigest = await trx
        .insertInto("digests")
        .values({
          org_id: org.ctx.orgId,
          user_id: org.userId,
          slot_key: "2026-11-20T08:01",
          period_start: new Date("2026-11-19T00:00:00Z"),
          period_end: new Date(EIGHT),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("outbox")
        .values({
          org_id: org.ctx.orgId,
          user_id: org.userId,
          kind: "digest",
          dedup_key: "digest:2026-11-20T08:01",
          digest_id: copyDigest.id,
          view: JSON.stringify(delivered?.view),
          buttons: "[]",
          created_at: new Date(EIGHT),
          next_attempt_at: new Date(EIGHT),
        })
        .execute();
      await trx.deleteFrom("chat_links").where("org_id", "=", org.ctx.orgId).execute();
      await createOutboxSender({ db: trx, channel, now: () => new Date(EIGHT) }).run();
      const failed = await trx
        .selectFrom("outbox")
        .select("status")
        .where("dedup_key", "=", "digest:2026-11-20T08:01")
        .executeTakeFirstOrThrow();
      expect(failed.status).toBe("failed");
      expect((await loopRow(trx, staleId)).stale_notified_at).toEqual(marked);
    });
  });
});

describe("N4 a mark of an earlier digest stays", () => {
  test("a loop that an earlier day showed keeps that time when the digest of the next day fails", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const earlier = new Date("2026-11-19T07:00:00Z");
      const loopId = await waitingLoop(trx, org, { surfaced_at: earlier });
      await runDigests(trx, EIGHT);
      expect((await loopRow(trx, loopId)).surfaced_at).toEqual(earlier);
      await trx.deleteFrom("chat_links").where("org_id", "=", org.ctx.orgId).execute();
      await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => new Date(EIGHT) }).run();
      expect(
        await trx.selectFrom("outbox").select("status").where("org_id", "=", org.ctx.orgId).executeTakeFirstOrThrow()
      ).toEqual({ status: "failed" });
      expect((await loopRow(trx, loopId)).surfaced_at).toEqual(earlier);
    });
  });
});

describe("N5 the day of a late slot", () => {
  test("the 20:00 slot that runs at 01:00 of the next date gets the count line, not a second brief", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await setDigestTimes(trx, org.ctx, org.userId, ["08:00", "16:00", "20:00"]);
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);
      // 2026-11-21 01:00 Warsaw: the 20:00 slot of 2026-11-20 is due and has not run.
      await runDigests(trx, "2026-11-21T00:00:00Z");
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts).toHaveLength(3);
      expect(texts[0]).toContain("NEEDS YOU TODAY");
      expect(texts[2]).not.toContain("NEEDS YOU TODAY");
      expect(texts[2]).toContain("Open loops: 1 waiting");
    });
  });
});
