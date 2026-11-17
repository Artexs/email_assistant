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
      '{"text":"Dzień dobry,\\n\\nTak, wtorek.","subject":"Re: Spotkanie","to":["anna@example.com"],"cc":["ala@example.com","tom@example.com"],"attachmentCount":1,"attachments":["8:plan.pdf|15:application/pdf|1200"]}'
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
    expect(keyOf({ attachments: [a, b] })).toContain('"5:a.txt|10:text/plain|1","5:b.txt|10:text/plain|2"');
    expect(keyOf({ attachments: [{ name: null, type: "text/plain", size: 3 }] })).toContain('"-|10:text/plain|3"');
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

  test("no name differs from the empty name", () => {
    const none = keyOf({ attachments: [{ name: null, type: "x", size: 1 }] });
    const empty = keyOf({ attachments: [{ name: "", type: "x", size: 1 }] });
    expect(none).not.toBe(empty);
    expect(empty).toContain('"0:|1:x|1"');
  });

  test("a separator inside a name or a type cannot move to the next field", () => {
    const one = keyOf({ attachments: [{ name: "a|b", type: "c", size: 1 }] });
    const two = keyOf({ attachments: [{ name: "a", type: "b|c", size: 1 }] });
    expect(one).not.toBe(two);
    const three = keyOf({ attachments: [{ name: "a|1:b", type: "c", size: 1 }] });
    const four = keyOf({ attachments: [{ name: "a", type: "1:b|c", size: 1 }] });
    expect(three).not.toBe(four);
    // The length counts the characters of the name, not its bytes.
    expect(keyOf({ attachments: [{ name: "zażółć.pdf", type: "x", size: 1 }] })).toContain('"10:zażółć.pdf|1:x|1"');
  });

  test("To and Cc are sets: a duplicate address changes nothing; a different address does", () => {
    expect(keyOf({ to: ["anna@example.com", "ANNA@example.com", " anna@example.com "] })).toBe(draftCopyKey(base));
    expect(keyOf({ cc: ["tom@example.com", "ala@example.com", "Tom@Example.com"] })).toBe(draftCopyKey(base));
    expect(keyOf({ to: ["anna@example.com", "x@example.com"] })).not.toBe(draftCopyKey(base));
    // An address in To is not the same as one in Cc.
    expect(keyOf({ to: ["anna@example.com", "ala@example.com"], cc: ["tom@example.com"] })).not.toBe(
      draftCopyKey(base)
    );
  });
});
