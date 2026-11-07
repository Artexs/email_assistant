import { describe, expect, test } from "bun:test";

import type { OriginalMail } from "./message";
import { QUOTE_MAX_CHARS, quoteCut, quoteOriginal } from "./quote";

const original: OriginalMail = {
  fromAddress: "a@x.pl",
  subject: "Oferta",
  receivedAt: new Date("2026-11-06T09:00:00Z"),
  messageId: "<m1@x.pl>",
  inReplyTo: null,
  references: [],
  bodyText: "Line one\r\nLine two\rLine three",
};

describe("quoteOriginal", () => {
  test("writes the header block in pl and en", () => {
    expect(quoteOriginal(original, "pl", "Europe/Warsaw")).toStartWith(
      "--- Oryginalna wiadomość ---\nOd: a@x.pl\nData: Fri 6 Nov 10:00\nTemat: Oferta\n\n> Line one"
    );
    expect(quoteOriginal(original, "en", "Europe/Warsaw")).toStartWith(
      "--- Original message ---\nFrom: a@x.pl\nDate: Fri 6 Nov 10:00\nSubject: Oferta\n\n> Line one"
    );
  });

  test("normalizes line ends and prefixes every body line", () => {
    const quote = quoteOriginal(original, "en", "Europe/Warsaw");
    expect(quote).not.toContain("\r");
    expect(quote.split("\n\n")[1]).toBe("> Line one\n> Line two\n> Line three");
  });

  test("cuts a long body", () => {
    const quote = quoteOriginal({ ...original, bodyText: "x".repeat(9000) }, "en", "Europe/Warsaw");
    expect(quote).toEndWith(`> ${"x".repeat(QUOTE_MAX_CHARS)} […]`);
  });

  test("marks a missing or blank body", () => {
    expect(quoteOriginal({ ...original, bodyText: null }, "en", "Europe/Warsaw")).toEndWith("> (no text)");
    expect(quoteOriginal({ ...original, bodyText: " \n " }, "en", "Europe/Warsaw")).toEndWith("> (no text)");
  });
});

describe("quoteCut", () => {
  test("cuts a long quote at a line end", () => {
    const quote = Array.from({ length: 100 }, () => `> ${"y".repeat(28)}`).join("\n");
    const result = quoteCut(quote, 1500);
    expect(result.cut).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1500);
    expect(quote.startsWith(result.text)).toBe(true);
    expect(quote[result.text.length]).toBe("\n");
  });

  test("keeps a short quote", () => {
    expect(quoteCut("> short")).toEqual({ text: "> short", cut: false });
  });
});
