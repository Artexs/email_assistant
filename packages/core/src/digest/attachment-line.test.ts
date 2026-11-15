import { describe, expect, test } from "bun:test";

import { attachmentFact, attachmentLine, type AttachmentPart } from "./attachment-line";

const part = (over: Partial<AttachmentPart> = {}): AttachmentPart => ({
  name: "faktura.pdf",
  type: "application/pdf",
  size: 122880,
  inline: false,
  ...over,
});

describe("attachmentLine", () => {
  test("1 one attachment: name and size in kB", () => {
    expect(attachmentLine({ attachments: [part()], count: 1 }, "en")).toBe("📎 1: faktura.pdf (120 kB)");
    expect(attachmentLine({ attachments: [part()], count: 1 }, "pl")).toBe("📎 1: faktura.pdf (120 kB)");
  });

  test("2 at most three names, then the rest", () => {
    const five = Array.from({ length: 5 }, (_, i) => part({ name: `f${i}.pdf`, size: 10 }));
    expect(attachmentLine({ attachments: five, count: 5 }, "en")).toBe(
      "📎 5: f0.pdf (10 B), f1.pdf (10 B), f2.pdf (10 B), +2 more"
    );
    expect(attachmentLine({ attachments: five, count: 5 }, "pl")).toBe(
      "📎 5: f0.pdf (10 B), f1.pdf (10 B), f2.pdf (10 B), +2 więcej"
    );
  });

  test("2b the count of the mail wins over the capture cut (list of 20, count 25)", () => {
    const list = Array.from({ length: 20 }, (_, i) => part({ name: `f${i}` }));
    expect(attachmentLine({ attachments: list, count: 25 }, "en")).toContain(
      "📎 25: f0 (120 kB), f1 (120 kB), f2 (120 kB), +22 more"
    );
  });

  test("3 an inline image alone gives no line; so does a calendar part or no attachment", () => {
    expect(attachmentLine({ attachments: [part({ inline: true, type: "image/png" })], count: 1 }, "en")).toBeNull();
    expect(
      attachmentLine({ attachments: [part({ type: "text/calendar; method=REQUEST" })], count: 1 }, "en")
    ).toBeNull();
    expect(attachmentLine({ attachments: [], count: 0 }, "en")).toBeNull();
  });

  test("3b inline and calendar parts are left out of the names and of the number", () => {
    const input = {
      attachments: [
        part({ inline: true, name: "logo.png" }),
        part({ name: "a.pdf" }),
        part({ type: "text/calendar", name: "i.ics" }),
      ],
      count: 3,
    };
    expect(attachmentLine(input, "en")).toBe("📎 1: a.pdf (120 kB)");
  });

  test("4 after retention the list is empty and the count stays", () => {
    expect(attachmentLine({ attachments: [], count: 2 }, "en")).toBe("📎 2");
    expect(attachmentLine({ attachments: [], count: 2 }, "pl")).toBe("📎 2");
  });

  test("5 sizes: B, kB without decimals, MB with one decimal (Polish comma)", () => {
    const line = (size: number, lang: "en" | "pl") => attachmentLine({ attachments: [part({ size })], count: 1 }, lang);
    expect(line(1468006, "pl")).toBe("📎 1: faktura.pdf (1,4 MB)");
    expect(line(1468006, "en")).toBe("📎 1: faktura.pdf (1.4 MB)");
    expect(line(1023, "en")).toBe("📎 1: faktura.pdf (1023 B)");
    expect(line(1024, "en")).toBe("📎 1: faktura.pdf (1 kB)");
    expect(line(1048575, "en")).toBe("📎 1: faktura.pdf (1.0 MB)");
  });

  test("6 a name loses control and bidi characters and is cut to 40 code points", () => {
    const dirty = attachmentLine({ attachments: [part({ name: "fak\u202etura\n.pdf" })], count: 1 }, "en");
    expect(dirty).toBe("📎 1: faktura .pdf (120 kB)");
    expect(dirty).not.toMatch(/[\u202e\n]/);
    const long = attachmentLine({ attachments: [part({ name: "x".repeat(60) })], count: 1 }, "en") ?? "";
    const name = long.slice("📎 1: ".length, long.lastIndexOf(" ("));
    expect(Array.from(name)).toHaveLength(40);
  });

  test("7 a null name shows the type; a link in a name is removed", () => {
    expect(attachmentLine({ attachments: [part({ name: null })], count: 1 }, "en")).toBe(
      "📎 1: application/pdf (120 kB)"
    );
    expect(attachmentLine({ attachments: [part({ name: "www.evil.test/x.pdf" })], count: 1 }, "en")).toBe(
      "📎 1: [link] (120 kB)"
    );
  });
});

describe("attachmentFact", () => {
  test("keeps only what the line may show; renders the same line as the raw input", () => {
    const raw = {
      attachments: [
        part({ inline: true, name: "logo.png" }),
        ...Array.from({ length: 5 }, (_, i) => part({ name: `f${i}.pdf` })),
      ],
      count: 6,
    };
    const fact = attachmentFact(raw);
    expect(fact?.attachments).toHaveLength(3);
    expect(fact?.count).toBe(5);
    expect(fact?.attachments.every((item) => !item.inline)).toBe(true);
    expect(fact === null ? null : attachmentLine(fact, "en")).toBe(attachmentLine(raw, "en"));
  });

  test("stores a clean, cut name: 40 code points, no link", () => {
    const fact = attachmentFact({
      attachments: [part({ name: "x".repeat(60) }), part({ name: "https://x.test/a" }), part({ name: "a\u202eb\nc" })],
      count: 3,
    });
    expect(Array.from(fact?.attachments[0]?.name ?? "")).toHaveLength(40);
    expect(fact?.attachments[1]?.name).toBe("[link]");
    expect(fact?.attachments[2]?.name).toBe("ab c");
  });

  test("is null when the line would be empty, and keeps a retained count", () => {
    expect(attachmentFact({ attachments: [part({ inline: true })], count: 1 })).toBeNull();
    expect(attachmentFact({ attachments: [], count: 0 })).toBeNull();
    expect(attachmentFact({ attachments: [], count: 2 })).toEqual({ attachments: [], count: 2 });
  });
});
