import { describe, expect, test } from "bun:test";

import { type DraftCopy, draftCopyKey } from "./index";

const base: DraftCopy = {
  text: "Dzień dobry,\n\nTak, wtorek.",
  subject: "Re: Spotkanie",
  to: ["Anna@Example.com"],
  cc: ["tom@example.com", "Ala@example.com"],
  attachmentCount: 1,
  attachments: [{ name: "plan.pdf", type: "application/pdf", size: 1200 }],
};

const keyOf = (change: Partial<DraftCopy>): string => draftCopyKey({ ...base, ...change });

describe("draftCopyKey", () => {
  test("is a canonical JSON string with fixed key order", () => {
    expect(draftCopyKey(base)).toBe(
      '{"text":"Dzień dobry,\\n\\nTak, wtorek.","subject":"Re: Spotkanie","to":["anna@example.com"],"cc":["ala@example.com","tom@example.com"],"attachmentCount":1,"attachments":["plan.pdf|application/pdf|1200"]}'
    );
  });

  test("a server re-encode does not change the key: line ends, trailing spaces, trailing blank lines, folded Subject", () => {
    const same = keyOf({ text: "Dzień dobry,  \r\n\r\nTak, wtorek.\r\n\r\n", subject: "Re:  Spotkanie\r\n " });
    expect(same).toBe(draftCopyKey(base));
  });

  test("the order and the case of the addresses do not change the key", () => {
    expect(keyOf({ cc: ["ALA@example.com", " TOM@example.com "], to: ["anna@example.com"] })).toBe(draftCopyKey(base));
  });

  test("a change of text, subject, To, Cc or attachment changes the key", () => {
    const keys = new Set([
      draftCopyKey(base),
      keyOf({ text: "Dzień dobry,\n\nNie, wtorek." }),
      keyOf({ text: "Dzień dobry,\n\n\nTak, wtorek." }),
      keyOf({ subject: "Re: Spotkanie 2" }),
      keyOf({ to: ["anna@example.com", "x@example.com"] }),
      keyOf({ to: ["other@example.com"] }),
      keyOf({ cc: ["tom@example.com"] }),
      keyOf({ cc: [], to: ["anna@example.com", "tom@example.com", "ala@example.com"] }),
      keyOf({ attachmentCount: 2 }),
      keyOf({ attachments: [] }),
      keyOf({ attachments: [{ name: "plan.pdf", type: "application/pdf", size: 1201 }] }),
      keyOf({ attachments: [{ name: "plan2.pdf", type: "application/pdf", size: 1200 }] }),
      keyOf({ attachments: [{ name: "plan.pdf", type: "text/plain", size: 1200 }] }),
    ]);
    expect(keys.size).toBe(13);
  });

  test("an attachment keeps its part order and the type is lower case", () => {
    const a = { name: "a.txt", type: "text/plain", size: 1 };
    const b = { name: "b.txt", type: "TEXT/PLAIN", size: 2 };
    expect(keyOf({ attachments: [a, b] })).not.toBe(keyOf({ attachments: [b, a] }));
    expect(keyOf({ attachments: [a, b] })).toContain('"a.txt|text/plain|1","b.txt|text/plain|2"');
    expect(keyOf({ attachments: [{ name: null, type: "text/plain", size: 3 }] })).toContain('"|text/plain|3"');
  });

  test("a copy with no readable text never has the key of a copy with a text", () => {
    expect(keyOf({ text: null })).not.toBe(draftCopyKey(base));
    expect(keyOf({ text: null })).not.toBe(keyOf({ text: "" }));
    expect(keyOf({ text: null })).toContain('"text":null');
  });

  test("a text with quotes, backslashes and a line break stays one valid JSON string", () => {
    const key = keyOf({ text: 'a "b" \\ c\nd', subject: 'x"y' });
    expect(JSON.parse(key).text).toBe('a "b" \\ c\nd');
  });
});
