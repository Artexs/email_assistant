import { describe, expect, test } from "bun:test";
import type { FetchMessageObject } from "imapflow";

import { HardError } from "../../../platform/errors";
import { renderSeedMessage } from "../seed";

import { bodyTextFromSource, parseHeaderBlock, toMessageMeta } from "./mapper";

function fetched(overrides: Partial<FetchMessageObject> = {}): FetchMessageObject {
  return {
    seq: 1,
    uid: 42,
    size: 1234,
    internalDate: new Date("2026-11-03T10:00:00Z"),
    envelope: {
      date: new Date("2026-11-03T09:59:00Z"),
      subject: "Budget",
      messageId: "<m-1@example.test>",
      inReplyTo: "<m-0@example.test>",
      from: [{ name: "Boss", address: "boss@example.test" }],
      to: [{ address: "me@example.test" }, { address: "you@example.test" }],
      cc: [{ address: "cc@example.test" }],
    },
    headers: Buffer.from("References: <a@x> <b@x>\r\nX-EA-Action-Id: act-1\r\n\r\n"),
    ...overrides,
  };
}

describe("parseHeaderBlock", () => {
  test("lower-cases names and unfolds continuation lines", () => {
    const raw = Buffer.from("References: <a@x>\r\n <b@x>\r\n\t<c@x>\r\nX-EA-Action-Id:  act-9 \r\n\r\n");
    const headers = parseHeaderBlock(raw);
    expect(headers.get("references")).toBe("<a@x> <b@x>\t<c@x>");
    expect(headers.get("x-ea-action-id")).toBe("act-9");
  });

  test("undefined gives an empty map", () => {
    expect(parseHeaderBlock(undefined).size).toBe(0);
  });
});

describe("toMessageMeta", () => {
  test("maps the envelope, size, dates and header block", () => {
    const meta = toMessageMeta(fetched());
    expect(meta).toEqual({
      uid: 42,
      size: 1234,
      internalDate: new Date("2026-11-03T10:00:00Z"),
      date: new Date("2026-11-03T09:59:00Z"),
      messageId: "<m-1@example.test>",
      inReplyTo: "<m-0@example.test>",
      references: ["<a@x>", "<b@x>"],
      from: "boss@example.test",
      to: ["me@example.test", "you@example.test"],
      cc: ["cc@example.test"],
      subject: "Budget",
      actionId: "act-1",
    });
  });

  test("references with 3 ids over folded lines", () => {
    const meta = toMessageMeta(fetched({ headers: Buffer.from("References: <a@x>\r\n <b@x>\r\n <c@x>\r\n\r\n") }));
    expect(meta.references).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(meta.actionId).toBeNull();
  });

  test("actionId is trimmed", () => {
    const meta = toMessageMeta(fetched({ headers: Buffer.from("X-EA-Action-Id:    act-7   \r\n\r\n") }));
    expect(meta.actionId).toBe("act-7");
  });

  test("empty Message-ID, In-Reply-To and References give null and []", () => {
    const meta = toMessageMeta(
      fetched({
        envelope: { messageId: "  ", inReplyTo: "", from: [], subject: "x" },
        headers: Buffer.from("References: \r\nX-EA-Action-Id: \r\n\r\n"),
      })
    );
    expect(meta.messageId).toBeNull();
    expect(meta.inReplyTo).toBeNull();
    expect(meta.references).toEqual([]);
    expect(meta.actionId).toBeNull();
    expect(meta.from).toBeNull();
    expect(meta.to).toEqual([]);
    expect(meta.cc).toEqual([]);
  });

  test("no envelope gives null fields", () => {
    const meta = toMessageMeta(fetched({ envelope: undefined, headers: undefined }));
    expect(meta.messageId).toBeNull();
    expect(meta.subject).toBeNull();
    expect(meta.date).toBeNull();
    expect(meta.references).toEqual([]);
  });

  test("an invalid Date header gives date null", () => {
    const meta = toMessageMeta(fetched({ envelope: { date: new Date("nope"), subject: "x" } }));
    expect(meta.date).toBeNull();
  });

  test("an INTERNALDATE string is parsed to a Date", () => {
    const meta = toMessageMeta(fetched({ internalDate: "2026-11-03T08:00:00.000Z" }));
    expect(meta.internalDate.toISOString()).toBe("2026-11-03T08:00:00.000Z");
  });

  test("a missing or invalid INTERNALDATE throws HardError", () => {
    expect(() => toMessageMeta(fetched({ internalDate: undefined }))).toThrow(HardError);
    expect(() => toMessageMeta(fetched({ internalDate: "not a date" }))).toThrow(HardError);
    expect(() => toMessageMeta(fetched({ internalDate: new Date(Number.NaN) }))).toThrow(HardError);
  });

  test("NUL characters are removed from subject, addresses and ids", () => {
    const meta = toMessageMeta(
      fetched({
        envelope: {
          subject: "Bud\u0000get",
          messageId: "<m\u0000-1@example.test>",
          from: [{ address: "bo\u0000ss@example.test" }],
          to: [{ address: "me\u0000@example.test" }],
          cc: [{ address: "\u0000cc@example.test" }],
        },
        headers: Buffer.from("References: <a\u0000@x>\r\nX-EA-Action-Id: act\u0000-1\r\n\r\n"),
      })
    );
    expect(meta.subject).toBe("Budget");
    expect(meta.messageId).toBe("<m-1@example.test>");
    expect(meta.from).toBe("boss@example.test");
    expect(meta.to).toEqual(["me@example.test"]);
    expect(meta.cc).toEqual(["cc@example.test"]);
    expect(meta.references).toEqual(["<a@x>"]);
    expect(meta.actionId).toBe("act-1");
  });
});

describe("bodyTextFromSource", () => {
  const base = {
    messageId: "<b-1@example.test>",
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: "Body",
    date: new Date("2026-11-03T10:00:00Z"),
  };

  test("a text mail gives its text", async () => {
    const source = Buffer.from(renderSeedMessage({ ...base, text: "Please approve the budget" }));
    expect(await bodyTextFromSource(source)).toContain("Please approve the budget");
  });

  test("an html-only mail gives the visible text without tags", async () => {
    const source = Buffer.from(renderSeedMessage({ ...base, html: "<p>Visible <b>words</b></p>" }));
    const text = await bodyTextFromSource(source);
    expect(text).toContain("Visible words");
    expect(text).not.toContain("<");
  });

  test("a broken source (parse error) gives null", async () => {
    // mailparser rejects a header block above 1 MiB.
    const source = Buffer.from(`Subject: ${"x".repeat(1_200_000)}\r\n\r\nhello`);
    expect(await bodyTextFromSource(source)).toBeNull();
  });

  test("a source without a text or html part gives null", async () => {
    expect(await bodyTextFromSource(Buffer.alloc(0))).toBeNull();
  });

  test("NUL characters are removed from the body text", async () => {
    const source = Buffer.from(renderSeedMessage({ ...base, text: "a\u0000b\u0000c" }));
    expect(await bodyTextFromSource(source)).toBe("abc");
  });

  test("the body text is cut to 100_000 characters", async () => {
    const source = Buffer.from(renderSeedMessage({ ...base, text: "x".repeat(120_000) }));
    expect((await bodyTextFromSource(source))?.length).toBe(100_000);
  });
});
