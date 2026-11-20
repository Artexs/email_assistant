import { describe, expect, test } from "bun:test";

import { featureFlags } from "../features";
import { textTables } from "../texts";
import type { Category } from "../triage/categories";

import { MESSAGE_MAX_CHARS } from "./message";
import { renderReviewPage, type ReviewItem } from "./review";

const now = new Date("2026-11-20T12:00:00Z");
const timeZone = "Europe/Warsaw";
const en = textTables.en;

function uuid(n: number): string {
  return `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`;
}

function item(n: number, category: Category, extra: Partial<ReviewItem> = {}): ReviewItem {
  return {
    emailId: uuid(n),
    category,
    from: `Ann${n} <ann${n}@firma.test>`,
    subject: `Subject ${n}`,
    receivedAt: new Date(Date.UTC(2026, 10, 19, 8, n)),
    aiText: `AI text ${n}`,
    ...extra,
  };
}

describe("renderReviewPage", () => {
  test("1: no items give the empty text and no buttons", () => {
    const message = renderReviewPage({ items: [], now, timeZone }, en);
    expect(message).toEqual({ text: en.review.empty, buttons: [] });
    expect(message.text).toBe("Nothing to review: every recent mail has a label.");
  });

  test("2: ✅ only for a category the user may confirm (delegation too, unsure not)", () => {
    const items = [item(1, "info"), item(2, "unsure"), item(3, "delegation")];
    const message = renderReviewPage({ items, now, timeZone }, en);
    expect(message.text.split("\n")[0]).toBe(
      "Review: 3 mails without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it."
    );
    expect(message.buttons).toEqual([
      [
        { text: "✅ 1", data: `vr:i:${uuid(1)}` },
        { text: "✏️ 1", data: `ve:${uuid(1)}` },
      ],
      [{ text: "✏️ 2", data: `ve:${uuid(2)}` }],
      [
        { text: "✅ 3", data: `vr:d:${uuid(3)}` },
        { text: "✏️ 3", data: `ve:${uuid(3)}` },
      ],
    ]);
    expect(message.text).toContain("1. ℹ️ Info · Ann1 <ann1@firma.test> · ");
    expect(message.text).toContain("💬 AI text 3");
  });

  test("a single mail says `1 mail`; no mail body field exists on the item", () => {
    const message = renderReviewPage({ items: [item(1, "spam")], now, timeZone }, en);
    expect(message.text).toContain("Review: 1 mail without a label");
    expect(Object.keys(item(1, "spam")).sort()).toEqual(
      ["aiText", "category", "emailId", "from", "receivedAt", "subject"].sort()
    );
  });

  test("3: ten mails with long summaries fit in one message; the buttons match the kept items", () => {
    // Two UTF-16 units per emoji: the cut texts reach about 500 units per item, so the page must drop items.
    const long = "😀".repeat(400);
    const items = Array.from({ length: 10 }, (_, i) =>
      item(i + 1, "info", { aiText: long, subject: long, from: long })
    );
    const message = renderReviewPage({ items, now, timeZone }, en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const kept = (message.text.match(/^\d+\. /gm) ?? []).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(10);
    expect(message.buttons).toHaveLength(kept);
    expect(message.text).toContain(`Review: ${kept} ${kept === 1 ? "mail" : "mails"} without`);
  });

  test("the page is exact: a missing summary, an empty one, a long one and a mail of today", () => {
    const items = [
      item(1, "urgent", { aiText: null }),
      item(2, "info", { aiText: "" }),
      item(3, "unsure", { from: null, subject: null, aiText: "a".repeat(121) }),
      item(4, "needs_reply", { receivedAt: new Date("2026-11-20T10:00:00Z") }),
    ];
    const message = renderReviewPage({ items, now, timeZone }, en);
    expect(message.text).toBe(
      [
        "Review: 4 mails without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.",
        "",
        "1. 🔴 Urgent · Ann1 <ann1@firma.test> · 19 Nov 09:01",
        "Subject 1",
        "",
        "2. ℹ️ Info · Ann2 <ann2@firma.test> · 19 Nov 09:02",
        "Subject 2",
        "",
        "3. ❓ Unsure · (unknown sender) · 19 Nov 09:03",
        "(no subject)",
        `💬 ${"a".repeat(119)}…`,
        "",
        "4. ✉️ Reply · Ann4 <ann4@firma.test> · 11:00",
        "Subject 4",
        "💬 AI text 4",
      ].join("\n")
    );
    expect(message.buttons.map((row) => row.map((button) => button.text))).toEqual([
      ["✅ 1", "✏️ 1"],
      ["✅ 2", "✏️ 2"],
      ["✏️ 3"],
      ["✅ 4", "✏️ 4"],
    ]);
  });

  test("a page of 60 mails keeps the first 23 and no more than fit in one message", () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1, "info", { aiText: "w".repeat(100) }));
    const message = renderReviewPage({ items, now, timeZone }, en);
    expect(message.text.split("\n")[0]).toContain("Review: 23 mails without a label");
    expect(message.text.length).toBe(3998);
    expect(message.buttons).toHaveLength(23);
    expect(message.buttons.at(-1)?.[0]?.data).toBe(`vr:i:${uuid(23)}`);
  });

  test("a page of exactly the maximum keeps every mail; a character more drops the last one", () => {
    // The last mail takes a subject of 1 to 80 characters and a summary of 1 to 119: that is the room to fill the page.
    const pageOf = (count: number, subject: number, summary: number) =>
      Array.from({ length: count }, (_, i) =>
        i < count - 1
          ? item(i + 1, "info", { aiText: "w".repeat(100) })
          : item(i + 1, "info", { subject: "s".repeat(subject), aiText: "w".repeat(summary) })
      );
    const lengthOf = (count: number): number =>
      renderReviewPage({ items: pageOf(count, 1, 1), now, timeZone }, en).text.length;
    let count = 1;
    while (lengthOf(count) <= MESSAGE_MAX_CHARS - 197) count += 1;
    const base = lengthOf(count);
    const room = MESSAGE_MAX_CHARS - base;
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThan(79 + 118);
    const subject = 1 + Math.min(room, 79);
    const summary = 1 + room - Math.min(room, 79);
    const whole = renderReviewPage({ items: pageOf(count, subject, summary), now, timeZone }, en);
    expect(whole.text.length).toBe(MESSAGE_MAX_CHARS);
    expect(whole.buttons).toHaveLength(count);
    const over = renderReviewPage({ items: pageOf(count, subject, summary + 1), now, timeZone }, en);
    expect(over.buttons).toHaveLength(count - 1);
    expect(over.text.split("\n")[0]).toContain(`Review: ${count - 1} mails without a label`);
  });

  test("Polish: plural forms and the same buttons", () => {
    const pl = textTables.pl;
    const head = (n: number) =>
      renderReviewPage(
        { items: Array.from({ length: n }, (_, i) => item(i + 1, "info")), now, timeZone },
        pl
      ).text.split(" bez etykiety")[0];
    expect(head(1)).toBe("Przegląd: 1 wiadomość");
    expect(head(3)).toBe("Przegląd: 3 wiadomości");
    expect(head(5)).toBe("Przegląd: 5 wiadomości");
  });

  test("4: the flag is off by default and belongs to E2a", () => {
    expect(featureFlags.review_command.default).toBe(false);
    expect(featureFlags.review_command.epic).toBe("E2a");
  });
});
