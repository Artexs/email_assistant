import { describe, expect, test } from "bun:test";

import type { OriginalMail } from "../outgoing/message";
import { QUOTE_MAX_CHARS } from "../outgoing/quote";

import { quoteReply } from "./quote";

const original: OriginalMail = {
  fromAddress: "jan@x.pl",
  fromName: "Jan Kowalski",
  subject: "Oferta",
  receivedAt: new Date("2026-11-06T09:00:00Z"),
  messageId: "<m1@x.pl>",
  inReplyTo: null,
  references: [],
  bodyText: "Linia 1\r\nLinia 2",
};

describe("quoteReply", () => {
  test("3 pl: the header line, then > on each line", () => {
    expect(quoteReply(original, "pl", "Europe/Warsaw")).toBe(
      "pt. 6 lis 10:00 Jan Kowalski napisał(a):\n> Linia 1\n> Linia 2"
    );
  });

  test("en: On <date>, <name> wrote:", () => {
    expect(quoteReply(original, "en", "Europe/Warsaw")).toBe(
      "On Fri 6 Nov 10:00, Jan Kowalski wrote:\n> Linia 1\n> Linia 2"
    );
  });

  test("the date is in the time zone of the organization", () => {
    expect(quoteReply(original, "en", "America/New_York")).toStartWith("On Fri 6 Nov 04:00, Jan Kowalski wrote:");
  });

  test("no display name: the address; a name with line breaks and bidi marks is one clean line", () => {
    expect(quoteReply({ ...original, fromName: null }, "en", "UTC")).toContain(", jan@x.pl wrote:\n");
    expect(quoteReply({ ...original, fromName: "  " }, "en", "UTC")).toContain(", jan@x.pl wrote:\n");
    const dirty = quoteReply({ ...original, fromName: "Jan\nSubject: x\u202e" }, "en", "UTC");
    expect(dirty.split("\n")[0]).toContain("Jan Subject: x wrote:");
    expect(dirty).not.toContain("\u202e");
  });

  test("a long name is cut", () => {
    const line = quoteReply({ ...original, fromName: "N".repeat(500) }, "en", "UTC").split("\n")[0] ?? "";
    expect(line.length).toBeLessThan(150);
  });

  test("a long body is cut at QUOTE_MAX_CHARS", () => {
    const quote = quoteReply({ ...original, bodyText: "x".repeat(9000) }, "en", "UTC");
    expect(quote).toEndWith(`> ${"x".repeat(QUOTE_MAX_CHARS)} […]`);
  });

  test("an original with no text gives no quote", () => {
    expect(quoteReply({ ...original, bodyText: null }, "pl", "UTC")).toBe("");
    expect(quoteReply({ ...original, bodyText: " \n " }, "pl", "UTC")).toBe("");
  });
});
