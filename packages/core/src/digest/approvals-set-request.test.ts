import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { renderApprovalSetRequest } from "./approvals";
import { TZ } from "./approvals.test-helper";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

const SET_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

function item(n: number, overrides: Partial<Parameters<typeof renderApprovalSetRequest>[0]["items"][number]> = {}) {
  return {
    n,
    delegateName: `Anna ${n}`,
    address: `anna${n}@example.com`,
    subject: `Offer ${n}`,
    dueAt: new Date("2026-11-05T12:00:00Z"),
    reminder: 1 as const,
    task: `check offer ${n}`,
    ...overrides,
  };
}

describe("renderApprovalSetRequest", () => {
  test("two items, one without a due date", () => {
    const message = renderApprovalSetRequest(
      {
        setId: SET_ID,
        items: [item(1), item(2, { dueAt: null, reminder: 2 })],
        timeZone: TZ,
      },
      textTables.en
    );
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("📤 Send 2 reminders?");
    expect(message.text).toContain("1. Anna 1 anna1@example.com — Offer 1 (due Thu 5 Nov, reminder 1 of 2)");
    expect(message.text).toContain("   Task: check offer 1");
    expect(message.text).toContain("2. Anna 2 anna2@example.com — Offer 2 (reminder 2 of 2)");
    expect(message.text).toContain("   Task: check offer 2");
    expect(message.text).toContain("Each reminder is the fixed reminder template with this task; it quotes nothing.");
    expect(message.text.endsWith("The system sends them after your tap.")).toBe(true);
    const row = message.buttons[0] ?? [];
    expect(row.map((button) => button.text)).toEqual(["📤 Send all", "✖️ Skip all"]);
    expect(parseCallback(row[0]?.data ?? "")).toEqual({ kind: "approve_set", setId: SET_ID });
    expect(parseCallback(row[1]?.data ?? "")).toEqual({ kind: "reject_set", setId: SET_ID });
  });

  test("one item reads singular", () => {
    const message = renderApprovalSetRequest({ setId: SET_ID, items: [item(1)], timeZone: TZ }, textTables.en);
    expect(message.text.split("\n")[0]).toBe("📤 Send 1 reminder?");
  });

  test("10 long items all stay listed within the limit", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(i + 1, {
        delegateName: `N${i + 1}${"n".repeat(100)}`,
        subject: `S${i + 1}${"s".repeat(200)}`,
        task: `T${i + 1}${"t".repeat(300)}`,
      })
    );
    const message = renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables.en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    for (let i = 1; i <= 10; i++) {
      expect(message.text).toContain(`${i}. N${i}`);
      expect(message.text).toContain(`anna${i}@example.com`);
      expect(message.text).toContain(`Task: T${i}`);
    }
  });

  test("11 items or none is a programming error", () => {
    const items = Array.from({ length: 11 }, (_, i) => item(i + 1));
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables.en)).toThrow(RangeError);
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items: [], timeZone: TZ }, textTables.en)).toThrow(
      RangeError
    );
  });
});

describe("renderApprovalSetRequest in Polish", () => {
  const pl = textTables.pl;

  test.each([
    [1, "📤 Wysłać 1 przypomnienie?"],
    [3, "📤 Wysłać 3 przypomnienia?"],
    [5, "📤 Wysłać 5 przypomnień?"],
  ])("%i items", (count, header) => {
    const items = Array.from({ length: count }, (_, i) => item(i + 1));
    const message = renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, pl);
    expect(message.text.split("\n")[0]).toBe(header);
    expect(message.buttons[0]?.map((button) => button.text)).toEqual(["📤 Wyślij wszystkie", "✖️ Pomiń wszystkie"]);
  });

  test("an item line has the Polish day, the reminder number and the task label", () => {
    const message = renderApprovalSetRequest(
      { setId: SET_ID, items: [item(1), item(2, { subject: null })], timeZone: TZ },
      pl
    );
    expect(message.text).toContain("1. Anna 1 anna1@example.com — Offer 1 (termin: czw. 5 lis, przypomnienie 1 z 2)");
    expect(message.text).toContain("   Zadanie: check offer 1");
    expect(message.text).toContain("— (bez tematu) (");
  });
});

describe("renderApprovalSetRequest, the whole text", () => {
  const set = (items: ReturnType<typeof item>[], locale: "en" | "pl" = "en") =>
    renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables[locale]).text;
  const address = (length: number) => `${"a".repeat(length - "@x.test".length)}@x.test`;
  // Ten items whose first-level text is exactly 4096 characters when `lastAddress` is 44 characters long.
  const tenItems = (lastAddress: number) =>
    Array.from({ length: 10 }, (_, index) =>
      item(index + 1, {
        delegateName: "N".repeat(80),
        address: address(index === 9 ? lastAddress : 50),
        subject: "s".repeat(80),
        dueAt: null,
        task: "t".repeat(150),
      })
    );

  test("two items: header, one block per item with and without a due day, both footer lines", () => {
    expect(set([item(1), item(2, { dueAt: null, reminder: 2 })]).split("\n")).toEqual([
      "📤 Send 2 reminders?",
      "",
      "1. Anna 1 anna1@example.com — Offer 1 (due Thu 5 Nov, reminder 1 of 2)",
      "   Task: check offer 1",
      "2. Anna 2 anna2@example.com — Offer 2 (reminder 2 of 2)",
      "   Task: check offer 2",
      "",
      "Each reminder is the fixed reminder template with this task; it quotes nothing.",
      "The system sends them after your tap.",
    ]);
  });

  test.each([
    [0, "a reminder set has 1 to 10 items, got 0"],
    [11, "a reminder set has 1 to 10 items, got 11"],
  ])("%d items is refused with a message that names the limits", (count, message) => {
    const items = Array.from({ length: count }, (_, index) => item(index + 1));
    expect(() => set(items)).toThrow(new RangeError(message));
  });

  test("a text of exactly 4096 characters keeps the full task of every item", () => {
    const text = set(tenItems(44));
    expect(text.length).toBe(4096);
    expect(text.split("\n")[3]).toBe(`   Task: ${"t".repeat(150)}`);
  });

  test("one character more makes every task shrink to 40 characters, none drops out", () => {
    const text = set(tenItems(45));
    expect(text.length).toBe(2997);
    expect(text.split("\n")[3]).toBe(`   Task: ${"t".repeat(39)}…`);
    expect(text.split("\n").filter((line) => /^\d+\. /.test(line))).toHaveLength(10);
  });
});
