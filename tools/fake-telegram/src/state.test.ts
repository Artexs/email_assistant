import { describe, expect, test } from "bun:test";

import { createFakeState } from "./state";

const CHAT = 42;

describe("fake state", () => {
  test("hasChat is true only after a user message", () => {
    const state = createFakeState();
    state.botSend({ chatId: CHAT, text: "hi", buttons: [] });
    expect(state.hasChat(CHAT)).toBe(false);
    state.sendAsUser({ chatId: CHAT, text: "hello" });
    expect(state.hasChat(CHAT)).toBe(true);
  });

  test("numbers messages per chat and updates globally", () => {
    const state = createFakeState();
    const first = state.sendAsUser({ chatId: CHAT, text: "one" });
    const second = state.sendAsUser({ chatId: CHAT, text: "two" });
    expect([first.message.messageId, second.message.messageId]).toEqual([1, 2]);
    expect([first.updateId, second.updateId]).toEqual([1, 2]);
  });

  test("adds a bot_command entity only for commands", () => {
    const state = createFakeState();
    state.sendAsUser({ chatId: CHAT, text: "/start abc" });
    state.sendAsUser({ chatId: CHAT, text: "hello" });
    const [command, plain] = state.takeUpdates({ limit: 100 });
    expect(command?.message?.entities).toEqual([{ type: "bot_command", offset: 0, length: 6 }]);
    expect(plain?.message?.entities).toBeUndefined();
  });

  test("offset confirms earlier updates", () => {
    const state = createFakeState();
    state.sendAsUser({ chatId: CHAT, text: "one" });
    state.sendAsUser({ chatId: CHAT, text: "two" });
    expect(state.takeUpdates({ offset: 2, limit: 100 }).map((u) => u.update_id)).toEqual([2]);
    expect(state.takeUpdates({ limit: 100 }).map((u) => u.update_id)).toEqual([2]);
  });

  test("a button press queues a callback with the current text", () => {
    const state = createFakeState();
    const sent = state.botSend({ chatId: CHAT, text: "pick", buttons: [[{ text: "Yes", data: "y" }]] });
    state.botEdit({ chatId: CHAT, messageId: sent.messageId, text: "pick now", buttons: sent.buttons });
    const { callback } = state.pressButton({ chatId: CHAT, messageId: sent.messageId, data: "y" });
    const [update] = state.takeUpdates({ limit: 10 });
    expect(update?.callback_query?.id).toBe(callback.id);
    expect(update?.callback_query?.message).toMatchObject({
      text: "pick now",
      reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "y" }]] },
    });
    expect(() => state.pressButton({ chatId: CHAT, messageId: sent.messageId, data: "n" })).toThrow("no such button");
  });

  test("an edit keeps the old text", () => {
    const state = createFakeState();
    const sent = state.botSend({ chatId: CHAT, text: "a", buttons: [] });
    const edited = state.botEdit({ chatId: CHAT, messageId: sent.messageId, text: "b", buttons: [] });
    expect(edited.text).toBe("b");
    expect(edited.edits).toEqual(["a"]);
  });

  test("nextUpdate resolves on a new update and at the time limit", async () => {
    const state = createFakeState();
    const controller = new AbortController();
    const early = state.nextUpdate(controller.signal, 5000);
    const start = Date.now();
    state.sendAsUser({ chatId: CHAT, text: "hi" });
    await early;
    expect(Date.now() - start).toBeLessThan(1000);

    const lateStart = Date.now();
    await state.nextUpdate(controller.signal, 50);
    expect(Date.now() - lateStart).toBeGreaterThanOrEqual(40);
  });
});
