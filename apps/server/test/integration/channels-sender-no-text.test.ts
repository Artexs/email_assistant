import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  captureLogs,
  T,
  SECRET,
  at,
  allLines,
  expectEvent,
  tenant,
  addRow,
  rowState,
  storedMessage,
  senderFor,
} from "./channels-sender-helpers";
import { isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

captureLogs();

describe("outbox sender, rows without text (F088)", () => {
  test("renders the row from its view; the stored text is the sent text; the log has no mail text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { marker: "MARKER-F088" });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(1);
      const message = s.channel.sent[0]?.message;
      expect(message?.text).toContain("MARKER-F088");
      expect((await rowState(trx, id)).status).toBe("sent");
      const stored = await storedMessage(trx, id);
      expect(stored.text).toBe(message?.text ?? null);
      expect(stored.buttons as unknown).toEqual(message?.buttons ?? []);
      expect(allLines().some((line) => line.includes("MARKER-F088"))).toBe(false);
    });
  });

  test("a view the renderer rejects fails as bad_view and logs ids only", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { view: {} });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(0);
      const row = await rowState(trx, id);
      expect(row.status).toBe("failed");
      expect(row.error_code).toBe("bad_view");
      expectEvent("outbox_bad_view", "error", { outbox_id: id, kind: "urgent" });
    });
  });

  test("a row with a text is sent with its stored text and buttons", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { view: {} });
      // A row from before the migration: the text is stored, the view is empty.
      await trx
        .updateTable("outbox")
        .set({ text: `${SECRET} old`, buttons: JSON.stringify([[{ text: "OK", data: "ok:old" }]]) })
        .where("id", "=", id)
        .execute();
      const before = await storedMessage(trx, id);
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent[0]?.message).toEqual({ text: before.text as string, buttons: before.buttons as never });
      expect(await storedMessage(trx, id)).toEqual(before);
    });
  });

  test("a stale sending row without text is rendered and sent again with a warning", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const id = await addRow(trx, t, { marker: "MARKER-F088" });
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: at(-6 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      const s = senderFor(trx);
      await s.run(T);
      expect((await rowState(trx, id)).status).toBe("sent");
      expectEvent("outbox_resent_after_stale", "warn", { outbox_id: id });
      expect((await storedMessage(trx, id)).text).toBe(s.channel.sent[0]?.message.text ?? null);
    });
  });

  test("the pl row renders Polish text and the en row English text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      await addRow(trx, t, { locale: "pl", marker: "same" });
      await addRow(trx, t, { locale: "en", marker: "same" });
      const s = senderFor(trx);
      await s.run(T);
      expect(s.channel.sent).toHaveLength(2);
      // The claim order of two rows with one creation time is not fixed: match each text by its title.
      const texts = s.channel.sent.map((sent) => sent.message.text);
      expect(texts.filter((text) => text.startsWith("🔴 Pilna wiadomość"))).toHaveLength(1);
      expect(texts.filter((text) => text.startsWith("🔴 Urgent mail"))).toHaveLength(1);
    });
  });

  test("the quiet hours hold a row without text; it is rendered after them", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const t = await tenant(trx);
      const night = new Date("2026-11-06T21:30:00Z");
      const id = await addRow(trx, t);
      const s = senderFor(trx);
      await s.run(night);
      const held = await rowState(trx, id);
      expect(held.status).toBe("pending");
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-07T06:00:00.000Z");
      expect((await storedMessage(trx, id)).text).toBeNull();
      expect(s.channel.sent).toHaveLength(0);
      await s.run(new Date("2026-11-07T06:00:00Z"));
      expect((await rowState(trx, id)).status).toBe("sent");
      expect(s.channel.sent).toHaveLength(1);
      expect((await storedMessage(trx, id)).text).toBe(s.channel.sent[0]?.message.text ?? null);
    });
  });
});
