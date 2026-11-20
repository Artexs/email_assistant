import { describe, expect, test } from "bun:test";

import { botBody, urgentNotice } from "./notice";

describe("urgentNotice", () => {
  test("the product renderer makes the text; no public-content rule is broken in either language", () => {
    for (const locale of ["en", "pl"] as const) {
      const message = urgentNotice(locale);
      expect(message.text.length).toBeGreaterThan(20);
      expect(message.text).toContain("Signature needed today");
    }
  });
  test("botBody turns the buttons into an inline keyboard and keeps the text", () => {
    const message = urgentNotice();
    const body = botBody(7, message) as {
      chat_id: number;
      text: string;
      reply_markup: { inline_keyboard: unknown[][] };
    };
    expect(body.chat_id).toBe(7);
    expect(body.text).toBe(message.text);
    expect(body.reply_markup.inline_keyboard).toHaveLength(message.buttons.length);
  });
});
