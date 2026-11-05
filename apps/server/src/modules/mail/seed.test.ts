import { describe, expect, test } from "bun:test";
import { simpleParser } from "mailparser";

import { isSyntheticMessageId, renderSeedMessage, type SeedMessage } from "./seed";

const base: SeedMessage = {
  messageId: "<a1@example.test>",
  from: "boss@example.test",
  to: ["me@example.test"],
  subject: "Hello",
  date: new Date("2026-11-03T10:00:00Z"),
  text: "Line one\nLine two",
};

describe("renderSeedMessage", () => {
  test("plain text message has the standard headers and CRLF ends", () => {
    const raw = renderSeedMessage(base);
    expect(raw).toContain("Message-ID: <a1@example.test>\r\n");
    expect(raw).toContain("From: boss@example.test\r\n");
    expect(raw).toContain("To: me@example.test\r\n");
    expect(raw).toContain("Subject: Hello\r\n");
    expect(raw).toContain(`Date: ${base.date.toUTCString()}\r\n`);
    expect(raw).toContain("MIME-Version: 1.0\r\n");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(raw).toContain("\r\n\r\nLine one\r\nLine two");
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("no messageId gives no Message-ID line", () => {
    const raw = renderSeedMessage({ ...base, messageId: undefined });
    expect(raw).not.toMatch(/^Message-ID:/im);
  });

  test("html only gives text/html", () => {
    const raw = renderSeedMessage({ ...base, text: undefined, html: "<p>Hi</p>" });
    expect(raw).toContain("Content-Type: text/html; charset=utf-8\r\n");
    expect(raw).toContain("<p>Hi</p>");
  });

  test("text and html give multipart/alternative with two parts", () => {
    const raw = renderSeedMessage({ ...base, html: "<p>Hi</p>" });
    const match = raw.match(/Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    expect(match).not.toBeNull();
    const boundary = match?.[1] ?? "";
    expect(raw.split(`--${boundary}\r\n`).length - 1).toBe(2);
    expect(raw).toContain(`--${boundary}--`);
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw).toContain("Content-Type: text/html; charset=utf-8");
  });

  test("threading and extra headers are written", () => {
    const raw = renderSeedMessage({
      ...base,
      cc: ["c@example.test"],
      inReplyTo: "<p@example.test>",
      references: ["<r1@example.test>", "<p@example.test>"],
      headers: { "X-EA-Action-Id": "act-1" },
    });
    expect(raw).toContain("Cc: c@example.test\r\n");
    expect(raw).toContain("In-Reply-To: <p@example.test>\r\n");
    expect(raw).toContain("References: <r1@example.test> <p@example.test>\r\n");
    expect(raw).toContain("X-EA-Action-Id: act-1\r\n");
  });

  test("a header value with a line break throws", () => {
    expect(() => renderSeedMessage({ ...base, subject: "a\nBcc: x@example.test" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, headers: { "X-A": "a\rb" } })).toThrow(Error);
  });

  test("non-ASCII in a header name or value throws", () => {
    expect(() => renderSeedMessage({ ...base, headers: { "X-Zażółć": "a" } })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, headers: { "X-A": "Zażółć" } })).toThrow(Error);
  });

  test("a Polish subject is an encoded word and mailparser reads it back", async () => {
    const subject = "Zażółć gęślą jaźń — pilne: serwer produkcyjny nie odpowiada, proszę o telefon";
    const raw = renderSeedMessage({ ...base, subject });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw.split("\r\n\r\n")[0]).not.toMatch(/[\u0080-\uffff]/);
    expect((await simpleParser(raw)).subject).toBe(subject);
  });

  test("a non-ASCII display name is encoded, the address stays raw", async () => {
    const raw = renderSeedMessage({ ...base, from: "Łukasz Nowak <lukasz@firma.test>" });
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <lukasz@firma\.test>\r$/m);
    const from = (await simpleParser(raw)).from?.value[0];
    expect(from?.address).toBe("lukasz@firma.test");
    expect(from?.name).toBe("Łukasz Nowak");
  });

  test("an ASCII display name and a bare address stay as they are", () => {
    const raw = renderSeedMessage({ ...base, from: "Marek Z <marek@firma.test>", to: ["me@example.test"] });
    expect(raw).toContain("From: Marek Z <marek@firma.test>\r\n");
    expect(raw).toContain("To: me@example.test\r\n");
  });

  test("a non-ASCII subject or display name with a line break throws", () => {
    expect(() => renderSeedMessage({ ...base, subject: "Zażółć\r\nBcc: evil@x.test" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, from: "Zażółć\r\nBcc: evil@x.test <a@firma.test>" })).toThrow(Error);
  });

  test("an address field with more than one <...> pair or stray brackets throws", () => {
    expect(() => renderSeedMessage({ ...base, from: "Name <a@x.test> <b@x.test>" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, from: "Na<me <a@x.test>" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, from: "a@x.test>" })).toThrow(Error);
  });

  test("a non-ASCII address part throws", () => {
    expect(() => renderSeedMessage({ ...base, from: "Łukasz <łukasz@firma.test>" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, from: "łukasz@firma.test" })).toThrow(Error);
  });
});

describe("isSyntheticMessageId", () => {
  test("a Message-ID that ends with @ea-seed.test> is synthetic, in any case", () => {
    expect(isSyntheticMessageId("<a@ea-seed.test>")).toBe(true);
    expect(isSyntheticMessageId("<A@EA-SEED.TEST>")).toBe(true);
  });

  test("another domain, no closing > or null is not synthetic", () => {
    expect(isSyntheticMessageId("<a@ea-seed.test.evil>")).toBe(false);
    expect(isSyntheticMessageId("a@ea-seed.test")).toBe(false);
    expect(isSyntheticMessageId(null)).toBe(false);
  });
});
