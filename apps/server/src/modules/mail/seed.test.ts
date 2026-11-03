import { describe, expect, test } from "bun:test";

import { renderSeedMessage, type SeedMessage } from "./seed";

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
    expect(() => renderSeedMessage({ ...base, subject: "Zażółć" })).toThrow(Error);
    expect(() => renderSeedMessage({ ...base, headers: { "X-Zażółć": "a" } })).toThrow(Error);
  });
});
