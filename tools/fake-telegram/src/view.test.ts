import { afterEach, describe, expect, test } from "bun:test";

import { startFakeTelegram, type FakeTelegram } from "./server";

const CHAT = 77;

let fake: FakeTelegram | undefined;

afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const start = () => {
  fake = startFakeTelegram();
  return fake;
};

const view = async (query = "") => {
  if (!fake) throw new Error("fake not started");
  const response = await fetch(`${fake.apiRoot}/_fake/view${query}`);
  return { status: response.status, type: response.headers.get("content-type"), html: await response.text() };
};

describe("read-only chat view", () => {
  test("escapes a script tag and emits no script element", async () => {
    start().state.botSend({ chatId: CHAT, text: "<script>alert(1)</script>", buttons: [] });
    const { status, html } = await view(`?chat=${CHAT}`);
    expect(status).toBe(200);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
  });

  test("turns only b, i and code back into tags; anything else stays escaped", async () => {
    start().state.botSend({
      chatId: CHAT,
      text: '<b>Urgent</b> <i>now</i> <code>x</code> <a href="x">link</a> <a>bare</a> <b>open',
      buttons: [],
    });
    const { html } = await view(`?chat=${CHAT}`);
    expect(html).toContain("<b>Urgent</b> <i>now</i> <code>x</code>");
    expect(html).toContain("&lt;a href=&quot;x&quot;&gt;link&lt;/a&gt;");
    expect(html).toContain("&lt;b&gt;open");
    expect(html).toContain("&lt;a&gt;bare&lt;/a&gt;");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<a>");
  });

  test("shows inline buttons as labels without any form control", async () => {
    start().state.botSend({
      chatId: CHAT,
      text: "Pick",
      buttons: [
        [
          { text: "Yes <1>", data: "y" },
          { text: "No", data: "n" },
        ],
      ],
    });
    const { html } = await view(`?chat=${CHAT}`);
    expect(html).toContain("Yes &lt;1&gt;");
    expect(html).toContain(">No<");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-");
  });

  test("lists messages in send order and shows an edited one once, with its latest text", async () => {
    const { state } = start();
    const first = state.botSend({ chatId: CHAT, text: "first", buttons: [] });
    state.botSend({ chatId: CHAT, text: "second", buttons: [] });
    state.botSend({ chatId: CHAT, text: "third", buttons: [] });
    state.botEdit({ chatId: CHAT, messageId: first.messageId, text: "first edited", buttons: [] });
    const { html } = await view(`?chat=${CHAT}`);
    expect(html.indexOf("first edited")).toBeLessThan(html.indexOf("second"));
    expect(html.indexOf("second")).toBeLessThan(html.indexOf("third"));
    expect(html.match(/first/g)?.length).toBe(1);
  });

  test("an unknown chat is a 404 and the id is escaped", async () => {
    start();
    const unknown = await view("?chat=999");
    expect(unknown.status).toBe(404);
    const hostile = await view(`?chat=${encodeURIComponent("<img src=x>")}`);
    expect(hostile.status).toBe(404);
    expect(hostile.html).toContain("&lt;img src=x&gt;");
    expect(hostile.html).not.toContain("<img");
  });

  test("refresh adds the meta tag only for a plain integer; other keys do nothing", async () => {
    start().state.botSend({ chatId: CHAT, text: "hi", buttons: [] });
    expect((await view(`?chat=${CHAT}&refresh=2`)).html).toContain('<meta http-equiv="refresh" content="2">');
    expect((await view(`?chat=${CHAT}&refresh=abc`)).html).not.toContain("http-equiv");
    expect((await view(`?chat=${CHAT}&refresh=2"><script>`)).html).not.toContain("http-equiv");
    expect((await view(`?chat=${CHAT}&other=1`)).html).not.toContain("http-equiv");
  });

  test("shows bot messages only", async () => {
    const { state } = start();
    state.sendAsUser({ chatId: CHAT, text: "from the user" });
    state.botSend({ chatId: CHAT, text: "from the bot", buttons: [] });
    const { html } = await view(`?chat=${CHAT}`);
    expect(html).toContain("from the bot");
    expect(html).not.toContain("from the user");
  });

  test("shows the banner, has no script or outside asset, and lists chats", async () => {
    start().state.botSend({ chatId: CHAT, text: "hi", buttons: [] });
    const { type, html } = await view();
    expect(type).toContain("text/html");
    expect(html).toContain("Test Telegram — not real");
    expect(html).toContain(`href="?chat=${CHAT}"`);
    expect(html).not.toMatch(/<script|<link|<img|src=|https?:\/\//);
  });
});
