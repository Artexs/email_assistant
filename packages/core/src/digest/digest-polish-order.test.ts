import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";
import type { Category } from "../triage/categories";

import { type DigestInput } from "./digest";
import { slot, mailbox, uuid, item, input, render, blockStarts } from "./digest.test-helper";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";

describe("renderDigestWithBrief in Polish (no brief)", () => {
  const pl = textTables.pl;
  const polish = (extra: Partial<DigestInput> = {}): OutMessage => render(input(extra), pl);

  test("scheduled and on-demand headers", () => {
    expect(polish().text.split("\n")[0]).toBe("📬 Podsumowanie 08:00 · pt. 6 lis");
    expect(polish({ slot: { ...slot, late: true } }).text.split("\n")[0]).toBe(
      "📬 Podsumowanie 08:00 · pt. 6 lis (spóźnione)"
    );
    const onDemand = polish({ kind: "on_demand", slot: null, now: new Date("2026-11-06T13:05:00Z") });
    expect(onDemand.text.split("\n")[0]).toBe("📬 Podsumowanie teraz · pt. 6 lis 14:05");
  });

  test("the mail count and the verb follow the Polish plural forms", () => {
    const since = (total: number, urgent: number): string => {
      const items = Array.from({ length: Math.min(total, 3) }, (_, i) => item(i + 1, "info"));
      return polish({ items, counts: { urgent, info: total - urgent } }).text.split("\n")[1] as string;
    };
    expect(since(1, 0)).toBe("Od 5 lis 16:00: 1 wiadomość, 0 wymaga działania");
    expect(since(3, 2)).toBe("Od 5 lis 16:00: 3 wiadomości, 2 wymagają działania");
    expect(since(5, 5)).toBe("Od 5 lis 16:00: 5 wiadomości, 5 wymaga działania");
    expect(since(22, 1)).toBe("Od 5 lis 16:00: 22 wiadomości, 1 wymaga działania");
  });

  test("no mail", () => {
    expect(polish().text.split("\n")[1]).toBe("Brak nowych wiadomości od 5 lis 16:00.");
  });

  test("section titles and item tags", () => {
    const items = [item(1, "urgent"), item(2, "info")];
    const text = polish({ items, counts: { urgent: 1, info: 1 } }).text;
    expect(text).toContain("WYMAGA DZIAŁANIA · 1");
    expect(text).toContain("POZOSTAŁE · 1");
    expect(blockStarts(text)[0]).toStartWith("1. 🔴 Pilne · ");
    expect(text).not.toContain("NEEDS ACTION");
  });

  test("mailbox lines, footer and shadow mode", () => {
    const text = polish({
      items: [item(1, "info")],
      counts: { info: 1 },
      mailboxes: [{ ...mailbox, lastSyncedAt: null }],
      skippedTooOld: 2,
      skippedBacklog: 3,
      waiting: 4,
      delegations: { open: 2, overdue: 5 },
    }).text;
    expect(text).toContain("⚠️ Ostatnia synchronizacja: nigdy");
    expect(text).toContain("📭 Nieprzetworzone (starsze niż 7 dni): 2");
    expect(text).toContain("📭 Nieprzetworzone (z czasu wstrzymania konta): 3");
    expect(text).toContain("⏳ Czeka na klasyfikację AI: 4");
    expect(text).toContain("👥 Zlecenia: 2 czekają na odpowiedź, 5 po terminie");
    expect(text).toContain("Tryb podglądu: system niczego nie zmienił w Twojej skrzynce.");
    expect(polish({ mailboxes: [] }).text).toContain("Ostatnia synchronizacja: brak połączonej skrzynki");
    const paused = polish({
      mailboxes: [
        { ...mailbox, status: "paused", statusChangedAt: new Date("2026-11-05T13:00:00Z"), lastSyncedAt: null },
      ],
    });
    expect(paused.text.split("\n")[2]).toBe("⏸ Wstrzymana od 5 lis 14:00 · ostatnia synchronizacja: nigdy");
    const blocked = polish({
      mailboxes: [
        {
          ...mailbox,
          status: "host_blocked",
          statusChangedAt: new Date("2026-11-06T06:40:00Z"),
          lastSyncedAt: new Date("2026-11-06T06:35:00Z"),
        },
      ],
    });
    expect(blocked.text.split("\n")).toContain(
      "⛔ Serwer poczty niedozwolony od 07:40 · ostatnia synchronizacja: 07:35"
    );
  });

  test("over the limit: the text is cut to the limit", () => {
    const mailboxes = Array.from({ length: 100 }, (_, i) => ({ ...mailbox, id: `m${i}`, address: "x".repeat(60) }));
    const message = polish({ mailboxes });
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text.length).toBe(MESSAGE_MAX_CHARS);
    expect(message.text.endsWith("…")).toBe(true);
    expect(message.text).toStartWith("📬 Podsumowanie 08:00");
  });

  test("over the item limit: the rest goes to the +N more line", () => {
    const items = Array.from({ length: 3 }, (_, i) => item(i + 1, "urgent"));
    const more = polish({ items, counts: { urgent: 5, info: 4 } }).text;
    expect(more).toContain("+6 więcej: 2 pilne, 4 info");
  });

  test("the category names in the +N more line follow the count", () => {
    const more = (category: Category, rest: number): string => {
      const text = polish({ items: [], counts: { [category]: rest } }).text;
      return text.split("\n").find((line) => line.startsWith("+")) as string;
    };
    // `items: []` lists nothing, so the whole count is the rest.
    expect([1, 2, 5, 22].map((n) => more("urgent", n))).toEqual([
      "+1 więcej: 1 pilna",
      "+2 więcej: 2 pilne",
      "+5 więcej: 5 pilnych",
      "+22 więcej: 22 pilne",
    ]);
    expect([1, 2, 5, 22].map((n) => more("unsure", n))).toEqual([
      "+1 więcej: 1 niepewna",
      "+2 więcej: 2 niepewne",
      "+5 więcej: 5 niepewnych",
      "+22 więcej: 22 niepewne",
    ]);
    expect([1, 2, 5, 22].map((n) => more("notification", n))).toEqual([
      "+1 więcej: 1 powiadomienie",
      "+2 więcej: 2 powiadomienia",
      "+5 więcej: 5 powiadomień",
      "+22 więcej: 22 powiadomienia",
    ]);
    expect(more("needs_reply", 5)).toBe("+5 więcej: 5 do odpowiedzi");
  });
});

describe("the order of the listed items", () => {
  test.each([
    { name: "oldest first", hours: [8, 9, 10] },
    { name: "mixed", hours: [9, 10, 8] },
  ])("items of one category list the newest first when the input is $name", ({ hours }) => {
    const items = hours.map((hour) => item(hour, "info", { receivedAt: new Date(Date.UTC(2026, 10, 6, hour)) }));
    const subjects = render(input({ items, counts: { info: 3 } }))
      .text.split("\n")
      .filter((line) => line.startsWith("Subject "));
    expect(subjects).toEqual(["Subject 10", "Subject 9", "Subject 8"]);
  });

  test("a mail that appears twice keeps the order of the input", () => {
    const receivedAt = new Date(Date.UTC(2026, 10, 6, 8));
    const items = [
      item(1, "info", { receivedAt, subject: "First copy" }),
      item(1, "info", { receivedAt, subject: "Second copy" }),
    ];
    const subjects = render(input({ items, counts: { info: 2 } }))
      .text.split("\n")
      .filter((line) => line.endsWith(" copy"));
    expect(subjects).toEqual(["First copy", "Second copy"]);
  });

  test("items received at the same time list by their id, smallest first", () => {
    const receivedAt = new Date(Date.UTC(2026, 10, 6, 8));
    const items = [3, 1, 2].map((n) => item(n, "info", { receivedAt }));
    const subjects = render(input({ items, counts: { info: 3 } }))
      .text.split("\n")
      .filter((line) => line.startsWith("Subject "));
    expect(subjects).toEqual(["Subject 1", "Subject 2", "Subject 3"]);
  });

  test("a category that has items shows its title once, with the count of the category", () => {
    const message = render(
      input({ items: [item(1, "urgent"), item(2, "urgent"), item(3, "info")], counts: { urgent: 4, info: 1 } })
    );
    expect(message.text.split("\n").filter((line) => line.includes(" · ") && line === line.toUpperCase())).toEqual([
      "NEEDS ACTION · 4",
      "OTHER MAIL · 1",
    ]);
  });
});

describe("the message of one mail and the +N more line", () => {
  test("one listed mail gives the exact text, one keyboard row and no more line", () => {
    const message = render(input({ items: [item(1, "needs_reply")], counts: { needs_reply: 1 } }));
    expect(message.text).toBe(
      [
        "📬 Digest 08:00 · Fri 6 Nov",
        "Since 5 Nov 16:00: 1 mail, 1 need action",
        "🔄 Last sync 07:55",
        "",
        "NEEDS ACTION · 1",
        "1. ✉️ Reply · Ann1 <ann1@firma.test>",
        "Subject 1",
        "💬 AI text 1",
        "→ would flag",
        "",
        "Shadow mode: the system changed nothing in your mailbox.",
      ].join("\n")
    );
    expect(message.buttons).toEqual([
      [
        { text: "✅ 1", data: `fr:r:${uuid(1)}` },
        { text: "✏️ 1", data: `fe:${uuid(1)}` },
      ],
    ]);
  });

  test("no items and no count gives no section and no footer", () => {
    expect(render(input()).text).toBe(
      ["📬 Digest 08:00 · Fri 6 Nov", "No new mail since 5 Nov 16:00.", "🔄 Last sync 07:55"].join("\n")
    );
  });

  test("a count above the listed mails gives the more line with the exact rest", () => {
    const items = [item(1, "urgent"), item(2, "info")];
    const message = render(input({ items, counts: { urgent: 3, info: 6, spam: 1 }, maxLines: 2 }));
    expect(message.text.split("\n").at(-2)).toBe("+8 more: 2 urgent, 5 info, 1 spam");
  });
});
