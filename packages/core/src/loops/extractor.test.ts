import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { DueRef } from "./dates";
import {
  EXTRACT_BODY_MAX,
  type ExtractorOutput,
  extractorInputOf,
  extractorOutputSchema,
  type SentFacts,
  type SentSkipReason,
  sentSkipReason,
} from "./extractor";

const now = new Date("2026-11-18T12:00:00Z");
const ACTION_ID = "6d1d7a5c-0000-4000-8000-000000000001";

// A mail that passes every filter; each test changes one field.
const base: SentFacts = {
  actionId: null,
  content: "stored",
  bodyText: "Prosze o odpowiedz do piatku.",
  sentAt: new Date("2026-11-17T09:00:00Z"),
  to: ["Anna@Example.com"],
  cc: [],
  listId: null,
  autoSubmitted: null,
  hasCalendar: false,
  ownAddresses: ["boss@corp.example"],
  now,
};

const manyTo = Array.from({ length: 6 }, (_, i) => `a${i}@x.example`);
const manyCc = Array.from({ length: 5 }, (_, i) => `b${i}@x.example`);

describe("sentSkipReason", () => {
  test("a plain mail is not skipped", () => {
    expect(sentSkipReason(base)).toBeNull();
    expect(sentSkipReason({ ...base, autoSubmitted: "no" })).toBeNull();
  });

  const cases: [SentSkipReason, Partial<SentFacts>][] = [
    ["system_draft", { actionId: ACTION_ID }],
    ["no_text", { content: "headers_only", bodyText: null }],
    ["no_text", { content: "gone", bodyText: null }],
    ["no_text", { bodyText: "  \n " }],
    ["too_old", { sentAt: new Date("2026-11-04T11:59:00Z") }],
    ["own_only", { to: ["BOSS@corp.example"], cc: ["boss@corp.example"] }],
    ["too_many", { to: manyTo, cc: manyCc }],
    ["list", { listId: "<list.example.com>" }],
    ["auto", { autoSubmitted: "auto-replied" }],
    ["calendar", { hasCalendar: true }],
  ];
  for (const [reason, change] of cases) {
    test(`${reason} with one fixture`, () => {
      expect(sentSkipReason({ ...base, ...change })).toBe(reason);
    });
  }

  test("the age limit is 14 days: exactly 14 days old passes", () => {
    expect(sentSkipReason({ ...base, sentAt: new Date("2026-11-04T12:00:00Z") })).toBeNull();
  });

  test("10 recipients (To and Cc together) pass, 11 give too_many", () => {
    expect(sentSkipReason({ ...base, to: manyTo, cc: manyCc.slice(0, 4) })).toBeNull();
    expect(sentSkipReason({ ...base, to: manyTo, cc: manyCc })).toBe("too_many");
  });

  test("04-T1: own addresses and recipients compare by the one address rule (padding, case)", () => {
    expect(sentSkipReason({ ...base, ownAddresses: ["Boss@Example.com"], to: [" boss@example.com"], cc: [] })).toBe(
      "own_only"
    );
    // The dotted capital I and the final sigma fold the same way on both sides.
    expect(sentSkipReason({ ...base, ownAddresses: ["νίκοσ@example.gr"], to: ["ΝΊΚΟΣ@example.gr"], cc: [] })).toBe(
      "own_only"
    );
  });

  test("a mix of own and other addresses is not own_only", () => {
    expect(sentSkipReason({ ...base, to: ["boss@corp.example", "anna@example.com"] })).toBeNull();
  });

  test("first hit wins: each reason comes before the ones after it", () => {
    // Every reason holds at the start; each step removes the reason that fired.
    const all: SentFacts = {
      ...base,
      actionId: ACTION_ID,
      content: "headers_only",
      bodyText: null,
      sentAt: new Date("2026-01-01T00:00:00Z"),
      to: ["boss@corp.example"],
      cc: [],
      listId: "x",
      autoSubmitted: "auto-generated",
      hasCalendar: true,
    };
    const steps: [SentSkipReason, Partial<SentFacts>][] = [
      ["system_draft", { actionId: null }],
      ["no_text", { content: "stored", bodyText: "x" }],
      ["too_old", { sentAt: base.sentAt }],
      ["own_only", { to: manyTo, cc: manyCc }],
      ["too_many", { to: ["a@x.example"], cc: [] }],
      ["list", { listId: null }],
      ["auto", { autoSubmitted: null }],
      ["calendar", { hasCalendar: false }],
    ];
    let facts = all;
    for (const [reason, remove] of steps) {
      expect(sentSkipReason(facts)).toBe(reason);
      facts = { ...facts, ...remove };
    }
    expect(sentSkipReason(facts)).toBeNull();
  });
});

const answer = {
  expects_reply: true,
  ask: "Potwierdzenie terminu",
  due: { kind: "word", word: "friday" },
  promise: null,
  promise_due: null,
  language: "pl",
} satisfies ExtractorOutput;

describe("extractorOutputSchema", () => {
  test("a valid answer passes unchanged", () => {
    expect(extractorOutputSchema.parse(answer)).toEqual(answer);
  });

  test("an ask of 81 characters becomes null; 80 stays", () => {
    expect(extractorOutputSchema.parse({ ...answer, ask: "a".repeat(81) }).ask).toBeNull();
    expect(extractorOutputSchema.parse({ ...answer, ask: "a".repeat(80) }).ask).toBe("a".repeat(80));
    expect(extractorOutputSchema.parse({ ...answer, ask: "" }).ask).toBeNull();
  });

  test("an ask is one line, trimmed, without bidi controls", () => {
    expect(extractorOutputSchema.parse({ ...answer, ask: "  Send\n the   file ‮" }).ask).toBe("Send the file");
  });

  test("a due date without expects_reply is dropped", () => {
    const out = extractorOutputSchema.parse({ ...answer, expects_reply: false });
    expect(out.due).toBeNull();
    expect(out.expects_reply).toBe(false);
  });

  test("a promise_due without a promise is dropped; with a promise it stays", () => {
    const due: DueRef = { kind: "date", date: "2026-11-20" };
    expect(extractorOutputSchema.parse({ ...answer, promise: null, promise_due: due }).promise_due).toBeNull();
    expect(extractorOutputSchema.parse({ ...answer, promise: "Send the offer", promise_due: due }).promise_due).toEqual(
      due
    );
    // A promise that the code empties drops its date too.
    expect(
      extractorOutputSchema.parse({ ...answer, promise: "x".repeat(81), promise_due: due }).promise_due
    ).toBeNull();
  });

  test("an ask or a promise with an address, a link or a long number becomes null", () => {
    const bad = [
      "Write to jan@example.com",
      "See http://x.test/a",
      "See https://x.test",
      "Open www.x.test",
      "Call 123456",
      "Pay 12 34 56 78",
    ];
    for (const text of bad) {
      const out = extractorOutputSchema.parse({ ...answer, ask: text, promise: text });
      expect(out.ask).toBeNull();
      expect(out.promise).toBeNull();
    }
    expect(extractorOutputSchema.parse({ ...answer, ask: "Send 5 files by 12" }).ask).toBe("Send 5 files by 12");
  });

  test("language other keeps the result", () => {
    expect(extractorOutputSchema.parse({ ...answer, language: "other" }).language).toBe("other");
  });

  test("an extra key, a missing key or a wrong type is refused", () => {
    expect(extractorOutputSchema.safeParse({ ...answer, extra: 1 }).success).toBe(false);
    expect(extractorOutputSchema.safeParse({ ...answer, due: { kind: "word", word: "friday", x: 1 } }).success).toBe(
      false
    );
    const missing = Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "language"));
    expect(extractorOutputSchema.safeParse(missing).success).toBe(false);
    expect(extractorOutputSchema.safeParse({ ...answer, expects_reply: "yes" }).success).toBe(false);
    expect(extractorOutputSchema.safeParse({ ...answer, due: { kind: "word", word: "someday" } }).success).toBe(false);
    expect(extractorOutputSchema.safeParse(null).success).toBe(false);
    expect(extractorOutputSchema.safeParse([]).success).toBe(false);
  });
});

describe("the JSON schema that the provider gets", () => {
  test("is a strict object with every output key required and no other key", () => {
    const json = z.toJSONSchema(extractorOutputSchema) as {
      type: string;
      additionalProperties: unknown;
      required: string[];
      properties: Record<string, unknown>;
    };
    const keys = ["ask", "due", "expects_reply", "language", "promise", "promise_due"];
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect([...json.required].sort()).toEqual(keys);
    expect(Object.keys(json.properties).sort()).toEqual(keys);
  });
});

describe("extractorInputOf", () => {
  const mail = {
    subject: "Offer",
    bodyText: "Hello Anna, please answer by Friday.",
    sentAt: new Date("2026-11-18T09:30:00Z"),
    to: ["anna@example.com", "tom@example.com"],
    cc: ["kim@example.com"],
  };

  test("holds the subject, the local date and the recipient count, and no address", () => {
    const input = extractorInputOf(mail, "Europe/Warsaw");
    expect(input).toEqual({
      subject: "Offer",
      sentLocal: { date: "2026-11-18", time: "10:30", weekday: "Wednesday" },
      recipientCount: 3,
      body: "Hello Anna, please answer by Friday.",
    });
    expect(JSON.stringify(input)).not.toContain("@");
  });

  test("cuts the body to 8,000 characters and never splits a surrogate pair", () => {
    expect(extractorInputOf({ ...mail, bodyText: "a".repeat(9000) }, "Europe/Warsaw").body).toHaveLength(
      EXTRACT_BODY_MAX
    );
    const emoji = `${"a".repeat(EXTRACT_BODY_MAX - 1)}😀`;
    expect(extractorInputOf({ ...mail, bodyText: emoji }, "Europe/Warsaw").body).toBe("a".repeat(EXTRACT_BODY_MAX - 1));
  });

  test("a null subject is an empty subject", () => {
    expect(extractorInputOf({ ...mail, subject: null }, "Europe/Warsaw").subject).toBe("");
  });
});

describe("extractorOutputSchema on answers that are not an object", () => {
  test.each([
    ["null", null, "null"],
    ["an array", [answer], "array"],
    ["a string", "text", "string"],
    ["a number", 5, "number"],
  ])("%s is refused as a whole, with the type of the input", (_label, value, received) => {
    const result = extractorOutputSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        expected: "object",
        code: "invalid_type",
        path: [],
        message: `Invalid input: expected object, received ${received}`,
      },
    ]);
  });

  test.each(["ask", "promise"] as const)("a missing %s is a schema failure; the code adds no null for it", (key) => {
    const { [key]: _removed, ...rest } = answer;
    const result = extractorOutputSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        expected: "string",
        code: "invalid_type",
        path: [key],
        message: "Invalid input: expected string, received undefined",
      },
    ]);
  });
});
