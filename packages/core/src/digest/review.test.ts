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
