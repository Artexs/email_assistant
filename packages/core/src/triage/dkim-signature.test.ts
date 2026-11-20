import { describe, expect, test } from "bun:test";

import {
  DKIM_LIMITS,
  dkimCoversOneClickHeaders,
  dkimSignaturesOf,
  dkimSignaturesSchema,
  type DkimSignature,
} from "./dkim-signature";

const COVERED = "from:list-unsubscribe:list-unsubscribe-post";

describe("dkimSignaturesOf", () => {
  test("1: the domain is lower case and the header names keep their order and repeats", () => {
    expect(dkimSignaturesOf(["DKIM-Signature: v=1; d=News.Example; h=From:To:To:Subject; bh=x; b=y"])).toEqual([
      { d: "news.example", h: ["from", "to", "to", "subject"] },
    ]);
  });

  test("2: folded lines, tabs and spaces around names and colons are removed, any case", () => {
    const line = [
      "DKIM-Signature: v=1; a=rsa-sha256;",
      "\td = a.example ;",
      "\th = From : LIST-Unsubscribe\r\n\t:\r\n List-UNSUBSCRIBE-post ;",
      " b=AAAA",
    ].join("\r\n");
    const [signature] = dkimSignaturesOf([line]);
    expect(signature).toEqual({ d: "a.example", h: ["from", "list-unsubscribe", "list-unsubscribe-post"] });
    expect(dkimCoversOneClickHeaders(signature?.h ?? [])).toBe(true);
  });

  test("3: the signature value and the body hash are never in the result", () => {
    const result = dkimSignaturesOf(["DKIM-Signature: v=1; d=a.example; h=from; bh=BODYHASH; b=SIGNATUREVALUE; z=x"]);
    expect(Object.keys(result[0] ?? {})).toEqual(["d", "h"]);
    expect(JSON.stringify(result)).not.toMatch(/BODYHASH|SIGNATUREVALUE/);
  });

  test("4: no header gives no signature", () => {
    expect(dkimSignaturesOf([])).toEqual([]);
  });

  test("5: more than 8 signature headers give no signature at all, 8 are kept", () => {
    const line = `DKIM-Signature: v=1; d=a.example; h=${COVERED}; b=y`;
    expect(dkimSignaturesOf(Array.from({ length: DKIM_LIMITS.signatures }, () => line))).toHaveLength(8);
    expect(dkimSignaturesOf(Array.from({ length: DKIM_LIMITS.signatures + 1 }, () => line))).toEqual([]);
  });

  test("6: a header over the line limit gives no signature at all, also next to a good one", () => {
    const good = `DKIM-Signature: v=1; d=a.example; h=${COVERED}; b=y`;
    const long = `DKIM-Signature: v=1; d=a.example; h=${COVERED}; z=${"A".repeat(DKIM_LIMITS.line)}`;
    expect(dkimSignaturesOf([good, long])).toEqual([]);
    expect(dkimSignaturesOf([good])).toHaveLength(1);
  });

  test("7: a header that does not parse gives no signature at all, also next to a good one", () => {
    const good = `DKIM-Signature: v=1; d=a.example; h=${COVERED}; b=y`;
    const bad = [
      "DKIM-Signature: v=1; d=a.example; d=b.example; h=from",
      "DKIM-Signature: v=1; h=from; b=y",
      "DKIM-Signature: v=1; d=a.example; b=y",
      "DKIM-Signature: v=1; d=a.example; h=from; nonsense",
      "DKIM-Signature: v=1; D=a.example; h=from",
      "DKIM-Signature: v=1; d=a.example.; h=from",
      "DKIM-Signature: v=1; d=localhost; h=from",
      "DKIM-Signature: v=1; d=a b.example; h=from",
      "DKIM-Signature: v=1; d=a.\r\n example; h=from",
      "no colon at all",
    ];
    for (const line of bad) expect({ line, found: dkimSignaturesOf([good, line]) }).toEqual({ line, found: [] });
  });

  test("8: names beyond 64 are dropped; an odd or long name is dropped; empty entries are skipped", () => {
    const names = Array.from({ length: 70 }, (_, i) => `x-h${i}`).join(":");
    expect(dkimSignaturesOf([`DKIM-Signature: d=a.example; h=${names}`])[0]?.h).toHaveLength(DKIM_LIMITS.names);
    const odd = `DKIM-Signature: d=a.example; h=from::bad name:${"a".repeat(41)}:to:`;
    expect(dkimSignaturesOf([odd])[0]?.h).toEqual(["from", "to"]);
  });

  test("9: a body-only signature (h= without the list headers) parses and does not cover", () => {
    const [signature] = dkimSignaturesOf(["DKIM-Signature: v=1; d=a.example; h=from; bh=x; b=y; l=100"]);
    expect(signature).toEqual({ d: "a.example", h: ["from"] });
    expect(dkimCoversOneClickHeaders(signature?.h ?? [])).toBe(false);
  });
});

describe("dkimSignaturesOf: the tags of one header line", () => {
  test.each<{ name: string; line: string; expected: DkimSignature[] }>([
    {
      name: "empty parts between and after the tags are skipped",
      line: "DKIM-Signature: d=a.example;; h=from; ;  ;",
      expected: [{ d: "a.example", h: ["from"] }],
    },
    {
      name: "the first = splits a tag: a later = stays in the value of h and drops that name",
      line: "DKIM-Signature: d=a.example; h=from:to=x:subject",
      expected: [{ d: "a.example", h: ["from", "subject"] }],
    },
    {
      name: "a colon that starts the line: the tags follow it",
      line: ":d=a.example; h=from",
      expected: [{ d: "a.example", h: ["from"] }],
    },
    {
      name: "an empty h gives a signature with no names",
      line: "DKIM-Signature: d=a.example; h=",
      expected: [{ d: "a.example", h: [] }],
    },
  ])("$name", ({ line, expected }) => {
    expect(dkimSignaturesOf([line])).toEqual(expected);
  });

  test.each([
    { name: "a line with no colon", line: "d=a.example; h=from" },
    { name: "a tag whose name is empty (the = comes first)", line: "DKIM-Signature: d=a.example; h=from; =1" },
    { name: "a tag whose name is only white space", line: "DKIM-Signature: d=a.example; h=from;  =1" },
    { name: "a repeated tag that is not read", line: "DKIM-Signature: d=a.example; h=from; bh=1; bh=2" },
    { name: "a repeated tag with spaces around its name", line: "DKIM-Signature: d=a.example; h=from; v=1;  v =1" },
    { name: "a repeated h", line: "DKIM-Signature: d=a.example; h=from; h=to" },
  ])("$name gives no signature", ({ line }) => {
    expect(dkimSignaturesOf([line])).toEqual([]);
  });
});

describe("dkimCoversOneClickHeaders", () => {
  test("10: both headers are needed; one alone, neither or a near name is not enough", () => {
    expect(dkimCoversOneClickHeaders(["from", "list-unsubscribe", "list-unsubscribe-post"])).toBe(true);
    expect(dkimCoversOneClickHeaders(["list-unsubscribe-post", "list-unsubscribe"])).toBe(true);
    expect(dkimCoversOneClickHeaders(["from", "list-unsubscribe"])).toBe(false);
    expect(dkimCoversOneClickHeaders(["from", "list-unsubscribe-post"])).toBe(false);
    expect(dkimCoversOneClickHeaders(["from", "list-id", "list-unsubscribe-poster"])).toBe(false);
    expect(dkimCoversOneClickHeaders([])).toBe(false);
  });
});

describe("dkimSignaturesSchema", () => {
  test("11: it takes the stored shape and refuses another one or more than 8 entries", () => {
    expect(dkimSignaturesSchema.safeParse([{ d: "a.example", h: ["from"] }]).success).toBe(true);
    expect(dkimSignaturesSchema.safeParse([]).success).toBe(true);
    expect(dkimSignaturesSchema.safeParse({ d: "a.example", h: [] }).success).toBe(false);
    expect(dkimSignaturesSchema.safeParse([{ d: "a.example" }]).success).toBe(false);
    expect(dkimSignaturesSchema.safeParse(null).success).toBe(false);
    expect(dkimSignaturesSchema.safeParse(Array.from({ length: 9 }, () => ({ d: "a.example", h: [] }))).success).toBe(
      false
    );
  });
});
