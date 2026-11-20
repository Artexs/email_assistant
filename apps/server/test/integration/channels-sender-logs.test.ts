import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { ChannelError, createOutboxSender } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { type Db } from "../../src/platform/db";

import { captureLogs, T, at, allLines, expectEvent, tenant, addRow, senderFor } from "./channels-sender-helpers";
import { addMember, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

// A fake bot token: it passes the value rule of the logger, so only a correct field list keeps it out of a line.
const CANARY = "123456:MARKER-TOKEN";

describe("outbox sender log events", () => {
  test("a sent row writes outbox_sent with its kind", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      await senderFor(trx).run(T);
      expectEvent("outbox_sent", "info", { outbox_id: id, kind: "urgent" });
    });
  });

  test("an expired row writes outbox_expired", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { createdAt: at(-25 * HOUR_MS) });
      await senderFor(trx).run(T);
      expectEvent("outbox_expired", "warn", { outbox_id: id });
    });
  });

  test("a member without a chat writes outbox_no_chat", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const other = await addMember(trx, t.ctx.orgId);
      const id = await addRow(trx, t, { userId: other });
      await senderFor(trx).run(T);
      expectEvent("outbox_no_chat", "warn", { outbox_id: id });
    });
  });

  test("a blocked bot writes outbox_bot_blocked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("blocked", "telegram_403"), 1);
      await s.run(T);
      expectEvent("outbox_bot_blocked", "warn", { outbox_id: id });
    });
  });

  test("a refused message writes outbox_refused with the code", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("bad_request", "telegram_400"), 1);
      await s.run(T);
      expectEvent("outbox_refused", "error", { outbox_id: id, code: "telegram_400" });
    });
  });

  test("another channel error writes outbox_failed with the code", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("other", "telegram_418"), 1);
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, code: "telegram_418" });
    });
  });

  test("a soft error writes outbox_paused with the code and the wait in milliseconds", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.failWith(new ChannelError("soft", "telegram_502"), 1);
      await s.run(T);
      expectEvent("outbox_paused", "warn", { outbox_id: id, code: "telegram_502", wait_ms: 30_000 });
    });
  });

  test("a failure that is no channel error writes outbox_failed with the error name and code, never its message", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.onSend = () => Promise.reject(Object.assign(new Error(CANARY), { code: "ECONNRESET" }));
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, error: "Error", error_code: "ECONNRESET" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });

  test("a failure with a value-rule-safe description writes no description", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      s.channel.onSend = () => Promise.reject(Object.assign(new Error("x"), { description: "MARKER-DESC" }));
      await s.run(T);
      expectEvent("outbox_failed", "error", { outbox_id: id, error: "Error" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });

  test("a failed claim writes outbox_claim_failed with the error name only", async () => {
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error(CANARY);
        },
      }
    ) as unknown as Db;
    const sender = createOutboxSender({ db: broken, channel: createFakeChannel(), now: () => T });
    await sender.run();
    expectEvent("outbox_claim_failed", "error", { error: "Error" });
    expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
  });

  test("a failed database call writes outbox_db_failed with the row id and the error name only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t);
      // The claim reads through `with`; only the later release (`updateTable`) fails.
      const flaky = new Proxy(trx, {
        get(target, property) {
          if (property === "updateTable") throw new Error(CANARY);
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const channel = createFakeChannel();
      channel.failWith(new ChannelError("soft", "telegram_502"), 1);
      await createOutboxSender({ db: flaky, channel, now: () => T }).run();
      expectEvent("outbox_db_failed", "error", { outbox_id: id, error: "Error" });
      expect(allLines().some((line) => line.includes("MARKER"))).toBe(false);
    });
  });
});

// The quiet hours of each member. 2026-11-06 is CET (UTC+1): local time is UTC + 1 h.
