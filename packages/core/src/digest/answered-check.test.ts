import { describe, expect, test } from "bun:test";

import { featureEpicPattern, featureFlags } from "../features";
import { textTables } from "../texts";
import { pluralCategory } from "../texts/locale";

import { ANSWERED_CHECK_LIMIT, renderAnsweredCheck, withAnsweredCheck, type AnsweredItem } from "./answered-check";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";

const opts = { now: new Date("2026-11-20T12:00:00Z"), timeZone: "Europe/Warsaw" };
const en = textTables.en;
const pl = textTables.pl;

function uuid(n: number): string {
  return `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`;
}

function item(n: number): AnsweredItem {
  return {
    emailId: uuid(n),
    category: n % 2 === 0 ? "spam" : "info",
    from: `Ann${n} <ann${n}@firma.test>`,
    subject: `Subject ${n}`,
    receivedAt: new Date(Date.UTC(2026, 10, 19, 8, n)),
  };
}

const items = (count: number) => Array.from({ length: count }, (_, index) => item(index + 1));
const page: OutMessage = { text: "PAGE", buttons: [[{ text: "✅ 1", data: "x:1" }]] };

describe("renderAnsweredCheck and withAnsweredCheck", () => {
  test("2 items: the text, one button row per item with ay: and an:", () => {
    const block = renderAnsweredCheck(items(2), opts, en);
    expect(block?.text.startsWith("You replied to 2 mails")).toBe(true);
    expect(block?.text).toContain('did not mark "needs reply". Did they need a reply?');
    expect(block?.text).toContain("1. ");
    expect(block?.text).toContain("Subject 2");
    expect(block?.buttons).toHaveLength(2);
    expect(block?.buttons[0]?.map((button) => button.data)).toEqual([`ay:${uuid(1)}`, `an:${uuid(1)}`]);
    expect(block?.buttons[1]?.map((button) => button.text)).toEqual(["✅ Yes 2", "➖ No 2"]);
  });

  test("1 item uses the singular", () => {
    const text = renderAnsweredCheck(items(1), opts, en)?.text ?? "";
    expect(text.startsWith("You replied to 1 mail that")).toBe(true);
    expect(text).toContain("Did it need a reply?");
  });

  test("0 items: no block, and the page stays as it is", () => {
    expect(renderAnsweredCheck([], opts, en)).toBeNull();
    expect(withAnsweredCheck(page, [], opts, en)).toBe(page);
  });

  test("page, a blank line, then the block; the buttons are the page's then the block's", () => {
    const message = withAnsweredCheck(page, items(2), opts, en);
    expect(message.text.startsWith("PAGE\n\nYou replied to 2 mails")).toBe(true);
    expect(message.buttons).toHaveLength(3);
    expect(message.buttons[0]).toEqual(page.buttons[0]);
  });

  test("a page of 4,000 characters and 5 items: at most 4,096 characters, buttons match the kept items", () => {
    expect(ANSWERED_CHECK_LIMIT).toBe(5);
    const long: OutMessage = { text: "p".repeat(4000), buttons: [] };
    const message = withAnsweredCheck(long, items(5), opts, en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const kept = message.buttons.length;
    expect(kept).toBeLessThan(5);
    const ids = message.buttons
      .map((row) => parseCallback(row[0]?.data ?? ""))
      .map((cb) => (cb && "emailId" in cb ? cb.emailId : ""));
    expect(ids).toEqual(
      items(5)
        .slice(0, kept)
        .map((entry) => entry.emailId)
    );
    for (let n = 1; n <= kept; n += 1) expect(message.text).toContain(`Subject ${n}`);
  });

  test("a page that leaves no room gives the page alone", () => {
    const full: OutMessage = { text: "p".repeat(MESSAGE_MAX_CHARS), buttons: [] };
    expect(withAnsweredCheck(full, items(5), opts, en)).toBe(full);
  });
});

describe("answered check texts", () => {
  test("every count: one colon at most per line, Polish forms follow pluralCategory", () => {
    for (const texts of [en, pl]) {
      for (let count = 1; count <= 25; count += 1) {
        const block = texts.review.answered.block(count);
        for (const line of block.split("\n")) expect(line.split(":").length - 1).toBeLessThanOrEqual(1);
      }
      for (const line of [texts.review.answered.savedYes, texts.review.answered.savedNo]) {
        expect(line.split(":").length - 1).toBe(1);
      }
    }
    const word = (count: number) => pl.review.answered.block(count).split(" ")[2];
    for (const count of [1, 2, 4, 5, 12, 22, 25]) {
      const category = pluralCategory("pl", count);
      expect(word(count)).toBe(category === "one" ? "wiadomość" : "wiadomości");
    }
    expect(pl.review.answered.block(1)).toContain("Czy wymagała odpowiedzi?");
    expect(pl.review.answered.block(5)).toContain("Czy wymagały odpowiedzi?");
  });
});

describe("the flag", () => {
  test("answered_check defaults off, epic E3a", () => {
    expect(featureFlags.answered_check.default).toBe(false);
    expect(featureFlags.answered_check.epic).toBe("E3a");
    expect(featureEpicPattern.test(featureFlags.answered_check.epic)).toBe(true);
  });
});
