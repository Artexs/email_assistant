import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, expect, test } from "bun:test";

import { createFakeTgClient } from "../../../apps/server/src/modules/lab";
import { testDb } from "../../../apps/server/test/integration/helpers";
import { startFakeTelegram } from "../src";

import {
  DOMAIN,
  RIGHT_DELEGATE,
  WRONG_DELEGATE,
  kinds,
  labId,
  makeExecutiveKit,
  runId,
  sendStatus,
} from "./lab-executive.test-helper";

// The executive driver presses nothing it must not: cards of other runs, other orgs, older than the run, a stopped run,
// a press with an intent and no done, and a restarted fake.
const db = testDb();
const kit = makeExecutiveKit(db);
const { withWorld } = kit;
afterAll(async () => {
  await db.destroy();
});
afterEach(kit.cleanup);

const { approvalCard, movedMail } = kit;

test(
  "4: a card for a non-lab mail, and one for a mail of another run, get no press and count as unmapped",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      await approvalCard(w, { to: RIGHT_DELEGATE, messageId: `<other-${Date.now()}@${DOMAIN}>` });
      await approvalCard(w, { to: RIGHT_DELEGATE, messageId: labId("w-1-008", "day-20261130-ffff") });
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 2, noRule: 0 });
      w.clock.at = new Date("2026-11-23T20:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(kinds(w.events())).not.toContain("tap_planned");
      expect(w.events().filter((event) => event.t === "skip")).toHaveLength(2);
    });
  },
  MINUTE_MS
);

// Every button prefix of the executive: after a tap_intent with no tap_done, no press of any kind follows.
const PREFIXES = ["ap", "ar", "rw:p", "as", "ag", "fu"] as const;

test(
  "5: tap_intent without tap_done: the next tick presses nothing of any kind and writes skip tap_unsure once",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });
      await w.tick();
      // Crash: a press fails on the wire after the intent is on disk.
      const real = w.deps.tg;
      let pressCalls = 0;
      w.deps.tg = {
        ...real,
        press: async () => {
          pressCalls += 1;
          throw new Error("connection lost");
        },
      };
      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(pressCalls).toBe(1);
      expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
      expect(kinds(w.events())).not.toContain("tap_done");

      // The process restarts with a healthy client: the intent blocks the press.
      w.deps.tg = real;
      w.restart();
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
      expect(w.events().filter((event) => event.t === "skip")).toEqual([
        expect.objectContaining({ code: "tap_unsure", ref: `${message.messageId}:ap:${sendId}` }),
      ]);

      // The same for each button kind: a planned tap with an intent and no done is never pressed.
      const idOf = "00000000-0000-4000-8000-000000000001";
      let presses = 0;
      w.deps.tg = {
        ...real,
        press: async () => {
          presses += 1;
        },
      };
      for (const [index, prefix] of PREFIXES.entries()) {
        const data = `${prefix}:${idOf}`;
        const key = `${900 + index}:${data}`;
        w.state.append(runId, { t: "tap_planned", key, at: "2026-11-23T08:05:00.000Z", data, messageId: 900 + index });
        w.state.append(runId, { t: "tap_intent", key, data });
      }
      await w.tick();
      await w.tick();
      expect(presses).toBe(0);
      const unsure = w.events().filter((event) => event.t === "skip" && event.code === "tap_unsure");
      expect(unsure).toHaveLength(PREFIXES.length + 1);
    });
  },
  MINUTE_MS
);

test(
  "6: a card in the other org's chat is never read or pressed; a card in the lab chat with another org's id is unmapped",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      // The other org (the `demo` org of orgs.json) holds a valid approval card of its own in its own chat.
      const other = await approvalCard(w, { org: w.b, to: RIGHT_DELEGATE });
      await w.tick();
      w.clock.at = new Date("2026-11-23T20:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.callbackData(w.b.chatId)).toEqual([]);
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, other.sendId)).toBe("awaiting_approval");
      expect(kinds(w.events())).not.toContain("tap_planned");

      // Cards in the lab chat that name the other org's send and the other org's wrongly moved urgent mail: the lookups
      // filter by org, so both cards are unmapped.
      const otherMoved = await movedMail(w, "w-1-011", "urgent", "ai_info", w.b);
      w.fake.state.botSend({
        chatId: w.a.chatId,
        text: "forged",
        buttons: [[{ text: "Approve", data: `ap:${other.sendId}` }]],
      });
      w.fake.state.botSend({
        chatId: w.a.chatId,
        text: "forged",
        buttons: [[{ text: "Undo", data: `fu:${otherMoved}` }]],
      });
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 2, noRule: 0 });
      w.clock.at = new Date("2026-11-24T08:00:00Z");
      await w.tick();
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, other.sendId)).toBe("awaiting_approval");
    });
  },
  MINUTE_MS
);

test(
  "7: a fake restart (no chat, or the newest id below the seen id): skip fake_restarted, no crash, no press",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      expect((await w.client.read(w.a.chatId)).length).toBeGreaterThanOrEqual(2);
      const seen = w
        .events()
        .filter((event) => event.t === "seen")
        .at(-1);
      expect(Number((seen as { ref: string }).ref)).toBeGreaterThanOrEqual(2);

      // A new fake with the chat known (one user message): its newest id is below the seen id.
      const restarted = startFakeTelegram();
      kit.fakes.push(restarted);
      const next = createFakeTgClient(restarted.apiRoot);
      await next.send(w.a.chatId, "/help");
      w.deps.tg = next;
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      const skips = w.events().filter((event) => event.t === "skip");
      expect(skips).toEqual([expect.objectContaining({ code: "fake_restarted", ref: String(w.a.chatId) })]);
      expect(
        w
          .events()
          .filter((event) => event.t === "seen")
          .at(-1)
      ).toMatchObject({ ref: "1" });
      // Seen is reset: the next tick reads from message 1 on and adds no second skip.
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.events().filter((event) => event.t === "skip")).toHaveLength(1);

      // A fake with no chat at all.
      const empty = startFakeTelegram();
      kit.fakes.push(empty);
      w.deps.tg = createFakeTgClient(empty.apiRoot);
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.events().filter((event) => event.t === "skip" && event.code === "fake_restarted")).toHaveLength(2);
      expect(
        w
          .events()
          .filter((event) => event.t === "seen")
          .at(-1)
      ).toMatchObject({ ref: "0" });
      // A dead chat is reported once.
      await w.tick();
      expect(w.events().filter((event) => event.t === "skip" && event.code === "fake_restarted")).toHaveLength(2);
      expect(kinds(w.events())).not.toContain("tap_planned");
    });
  },
  MINUTE_MS
);

test(
  "7b: cards older than the start of the run are never pressed",
  async () => {
    await withWorld(async (w) => {
      // Two valid cards exist before the first tick of the run: a reused chat.
      const old = await approvalCard(w, { to: RIGHT_DELEGATE });
      const oldWrong = await approvalCard(w, { to: WRONG_DELEGATE, slotId: "w-1-017" });
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      w.clock.at = new Date("2026-11-23T20:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, old.sendId)).toBe("awaiting_approval");
      expect(await sendStatus(w.trx, oldWrong.sendId)).toBe("awaiting_approval");
      expect(kinds(w.events())).toEqual(["seen"]);

      // A card after the start is read.
      const fresh = await approvalCard(w, { to: RIGHT_DELEGATE, slotId: "w-1-018" });
      expect((await w.tick()).planned).toBe(1);
      expect(w.events().find((event) => event.t === "tap_planned")).toMatchObject({ data: `ap:${fresh.sendId}` });
    });
  },
  MINUTE_MS
);

test(
  "TG2: a stopped run is not read and presses nothing, even a planned tap",
  async () => {
    await withWorld(async (w) => {
      await w.tick();
      const { sendId } = await approvalCard(w, { to: RIGHT_DELEGATE });
      expect((await w.tick()).planned).toBe(1);
      await approvalCard(w, { to: RIGHT_DELEGATE, slotId: "w-1-017" });
      w.state.stopRun(runId, "operator");
      const before = w.events().length;
      w.clock.at = new Date("2026-11-23T12:00:00Z");
      expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
      expect(w.events()).toHaveLength(before);
      expect(w.callbackData(w.a.chatId)).toEqual([]);
      expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
    });
  },
  MINUTE_MS
);
