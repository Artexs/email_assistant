import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, expect, test } from "bun:test";

import { getActionFeedback } from "../../../apps/server/src/modules/actions";
import { insertDraftAndSend } from "../../../apps/server/test/integration/fixtures";
import { testDb } from "../../../apps/server/test/integration/helpers";

import {
  RIGHT_DELEGATE,
  WRONG_DELEGATE,
  labId,
  makeExecutiveKit,
  sendStatus,
  slotOf,
  until,
  kinds,
} from "./lab-executive.test-helper";

// The executive driver presses the approval and reminder cards of the run (ap:, ar:, rw:p:, as:, ag:).
const db = testDb();
const kit = makeExecutiveKit(db);
const { withWorld } = kit;
afterAll(async () => {
  await db.destroy();
});
afterEach(kit.cleanup);

const { approvalCard } = kit;

test(
  "1: a delegation to the expected delegate gets one ap: press at its time; the action is approved",
  async () => {
    slotOf("w-1-008", "delegation");
    await withWorld(async (w) => {
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });

      expect(await w.tick()).toEqual({ planned: 1, pressed: 0, unmapped: 0, noRule: 0 });
      const planned = w.events().find((event) => event.t === "tap_planned");
      expect(planned).toMatchObject({ t: "tap_planned", data: `ap:${sendId}`, messageId: message.messageId });
      // Monday 09:00 in Warsaw: the tap falls 5 to 90 minutes after it.
      const at = Date.parse((planned as { at: string }).at);
      expect(at).toBeGreaterThanOrEqual(Date.parse("2026-11-23T08:05:00Z"));
      expect(at).toBeLessThanOrEqual(Date.parse("2026-11-23T09:30:00Z"));
      expect(w.callbackData(w.a.chatId)).toEqual([]);

      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 1, unmapped: 0, noRule: 0 });
      await until("send approved", async () => (await sendStatus(w.trx, sendId)) === "approved");
      expect(w.callbackData(w.a.chatId)).toEqual([`ap:${sendId}`]);
      expect(kinds(w.events()).filter((type) => type.startsWith("tap_"))).toEqual([
        "tap_planned",
        "tap_intent",
        "tap_done",
      ]);

      // Later ticks press nothing again.
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.callbackData(w.a.chatId)).toEqual([`ap:${sendId}`]);
    });
  },
  MINUTE_MS
);

test(
  "2: a delegation to another delegate: ar:, then rw:p: on the same message after the edit, over a restart",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const { sendId, message } = await approvalCard(w, { to: WRONG_DELEGATE });
      await w.tick();
      const planned = w.events().find((event) => event.t === "tap_planned");
      expect(planned).toMatchObject({ data: `ar:${sendId}`, then: "p", messageId: message.messageId });

      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect((await w.tick()).pressed).toBe(1);
      await until("send rejected", async () => (await sendStatus(w.trx, sendId)) === "rejected");
      // The server edits the same message into the reason card.
      await until(
        "reason buttons",
        async () =>
          (await w.client.read(w.a.chatId))
            .find((card) => card.messageId === message.messageId)
            ?.buttons.flat()
            .some((button) => button.data === `rw:p:${sendId}`) ?? false
      );

      // The lab process restarts between the two presses: the reason comes from the stored event.
      w.restart();
      expect(await w.tick()).toEqual({ planned: 1, pressed: 0, unmapped: 0, noRule: 0 });
      expect(
        w
          .events()
          .filter((event) => event.t === "tap_planned")
          .at(-1)
      ).toMatchObject({
        data: `rw:p:${sendId}`,
        messageId: message.messageId,
      });
      w.clock.at = new Date("2026-11-23T15:00:00Z");
      expect((await w.tick()).pressed).toBe(1);
      await until("reject reason saved", async () => {
        const row = await getActionFeedback(w.trx, { orgId: w.a.orgId }, sendId, "reject_reason");
        return row?.reason === "wrong_person";
      });
      expect(w.callbackData(w.a.chatId)).toEqual([`ar:${sendId}`, `rw:p:${sendId}`]);
      expect((await w.tick()).planned).toBe(0);
      // Each press writes its intent before the press and its done after it: planned, intent, done, in this order, once.
      // A press with no intent would be pressed again and answered 404 (the button is gone): `tap_gone` shows it.
      const tapEvents = w
        .events()
        .filter((event) => event.t.startsWith("tap_") || (event.t === "skip" && event.code === "tap_gone"))
        .map((event) => [event.t, (event as { key?: string; ref?: string }).key ?? (event as { ref?: string }).ref]);
      const arKey = `${message.messageId}:ar:${sendId}`;
      const rwKey = `${message.messageId}:rw:p:${sendId}`;
      expect(tapEvents).toEqual([
        ["tap_planned", arKey],
        ["tap_intent", arKey],
        ["tap_done", arKey],
        ["tap_planned", rwKey],
        ["tap_intent", rwKey],
        ["tap_done", rwKey],
      ]);
    });
  },
  MINUTE_MS
);

test(
  "TG2: a press the fake refuses (the button is gone) writes tap_gone, not tap_done, and is not tried again",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });
      expect((await w.tick()).planned).toBe(1);
      // The card loses its buttons before the press: the fake answers 404 and queues no callback.
      w.fake.state.botEdit({ chatId: w.a.chatId, messageId: message.messageId, text: "gone", buttons: [] });
      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      const key = `${message.messageId}:ap:${sendId}`;
      expect(w.events().filter((event) => event.t.startsWith("tap_") || event.t === "skip")).toEqual([
        expect.objectContaining({ t: "tap_planned", key }),
        expect.objectContaining({ t: "tap_intent", key }),
        expect.objectContaining({ t: "skip", code: "tap_gone", ref: key }),
      ]);
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
      await w.tick();
      expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
    });
  },
  MINUTE_MS
);

test(
  "TG2: an as: press on a reminder set card approves the set; an ag: press on a failed send creates a new send",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const ctx = { orgId: w.a.orgId };
      const setId = randomUUID();
      const reminder = await insertDraftAndSend(w.trx, ctx, w.a.mailboxId, {
        reminder: 1,
        setId,
        to: RIGHT_DELEGATE,
        messageId: labId("w-1-008"),
        createdAt: new Date(),
      });
      const failed = await insertDraftAndSend(w.trx, ctx, w.a.mailboxId, {
        to: RIGHT_DELEGATE,
        messageId: labId("w-1-017"),
        sendStatus: "failed",
        createdAt: new Date(),
      });
      await w.trx
        .updateTable("actions")
        .set({ status_reason: "smtp_error" })
        .where("id", "=", failed.sendId)
        .where("org_id", "=", w.a.orgId)
        .execute();
      await w.runtime.notify();
      const buttons = async (): Promise<string[]> =>
        (await w.client.read(w.a.chatId)).flatMap((message) => message.buttons.flat().map((button) => button.data));
      await until("set and failed cards", async () => {
        const data = await buttons();
        return data.includes(`as:${setId}`) && data.includes(`ag:${failed.sendId}`);
      });

      expect((await w.tick()).planned).toBe(2);
      w.clock.at = new Date("2026-11-24T12:00:00Z");
      expect((await w.tick()).pressed).toBe(2);
      await until("set approved", async () => (await sendStatus(w.trx, reminder.sendId)) === "approved");
      await until("new send for the failed one", async () => {
        const rows = await w.trx
          .selectFrom("actions")
          .select("id")
          .where("email_id", "=", failed.emailId)
          .where("type", "=", "send")
          .execute();
        return rows.length === 2;
      });
      expect(w.callbackData(w.a.chatId).sort()).toEqual([`ag:${failed.sendId}`, `as:${setId}`].sort());
      // No second ag: for the same action, even after the new send card appears.
      await w.tick();
      expect(w.callbackData(w.a.chatId)).toHaveLength(2);
    });
  },
  MINUTE_MS
);
