import { afterAll, expect, test } from "bun:test";

import { createFakeTgClient } from "../../../apps/server/src/modules/lab";
import { startFakeTelegram } from "../src";

// The lab's HTTP client against the real fake: it reads the control routes of the fake, not a copy of them.
const fakes: { stop(): Promise<void> }[] = [];
afterAll(async () => {
  await Promise.all(fakes.map((fake) => fake.stop()));
});

test("hasChat is false for a new fake, true after a user message, false again on a new fake (a restart)", async () => {
  const fake = startFakeTelegram();
  fakes.push(fake);
  const client = createFakeTgClient(fake.apiRoot);
  const chatId = 5550123;

  expect(await client.hasChat(chatId)).toBe(false);
  expect(await client.read(chatId)).toEqual([]);

  await client.send(chatId, "/help");
  expect(await client.hasChat(chatId)).toBe(true);
  const messages = await client.read(chatId);
  expect(messages.map((message) => [message.from, message.text])).toContainEqual(["user", "/help"]);

  const restarted = startFakeTelegram();
  fakes.push(restarted);
  expect(await createFakeTgClient(restarted.apiRoot).hasChat(chatId)).toBe(false);
});

test("press taps a button of a bot message; a missing button is an error", async () => {
  const fake = startFakeTelegram();
  fakes.push(fake);
  const client = createFakeTgClient(fake.apiRoot);
  const chatId = 5550124;
  await client.send(chatId, "hello");
  const message = fake.state.botSend({ chatId, text: "card", buttons: [[{ text: "Yes", data: "ok:1" }]] });

  await client.press(chatId, message.messageId, "ok:1");
  expect(fake.state.callbacks(chatId).map((callback) => callback.data)).toEqual(["ok:1"]);
  await expect(client.press(chatId, message.messageId, "no:1")).rejects.toThrow("HTTP 404");
});
