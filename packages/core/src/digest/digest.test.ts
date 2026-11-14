import { describe, expect, test } from "bun:test";

import { textTables, type CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { isFeedbackCallback, parseCallback } from "./callback";
import { DIGEST_MAX_LINES, renderDigest, type DigestInput, type DigestItem, type DigestMailbox } from "./digest";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";
import { cutText } from "./text";

const timeZone = "Europe/Warsaw";
const now = new Date("2026-11-06T07:00:00Z");
const slot = { date: "2026-11-06", time: "08:00", late: false };
const mailbox: DigestMailbox = {
  id: "m1",
  address: "boss@firma.test",
  status: "active",
  lastSyncedAt: new Date("2026-11-06T06:55:00Z"),
  statusChangedAt: new Date("2026-11-01T00:00:00Z"),
  mode: "shadow",
};

function uuid(n: number): string {
  return `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`;
}

function item(n: number, category: Category, extra: Partial<DigestItem> = {}): DigestItem {
  return {
    emailId: uuid(n),
    category,
    from: `Ann${n} <ann${n}@firma.test>`,
    subject: `Subject ${n}`,
    receivedAt: new Date(Date.UTC(2026, 10, 6, 5, n)),
    synthetic: false,
    folderTag: null,
    aiText: `AI text ${n}`,
    wouldDo: "would flag",
    undoable: false,
    ...extra,
  };
}

function input(extra: Partial<DigestInput> = {}): DigestInput {
  return {
    kind: "scheduled",
    now,
    timeZone,
    slot,
    periodStart: new Date("2026-11-05T15:00:00Z"),
    mailboxes: [mailbox],
    counts: {},
    items: [],
    skippedTooOld: 0,
    skippedBacklog: 0,
    waiting: 0,
    ...extra,
  };
}

// The old cases render with the English texts; the Polish cases pass `textTables.pl`.
const render = (digest: DigestInput, texts: CoreTexts = textTables.en): OutMessage => renderDigest(digest, texts);

const blockStarts = (text: string): string[] => text.split("\n").filter((line) => /^\d+\. /.test(line));

function emailIdOf(data: string): string | undefined {
  const parsed = parseCallback(data);
  return parsed !== null && isFeedbackCallback(parsed) ? parsed.emailId : undefined;
}

describe("renderDigest", () => {
  test("empty digest still shows the last sync", () => {
    const message = render(input());
    expect(message.text).toBe("📬 Digest 08:00 · Fri 6 Nov\nNo new mail since 5 Nov 16:00.\n🔄 Last sync 07:55");
    expect(message.buttons).toEqual([]);
  });

  test("orders sections and categories, unsure has only edit", () => {
    const items = [
      item(1, "spam"),
      item(2, "notification"),
      item(3, "info"),
      item(4, "unsure"),
      item(5, "needs_reply"),
      item(6, "urgent"),
    ];
    const counts = { urgent: 1, needs_reply: 1, unsure: 1, info: 1, notification: 1, spam: 1 };
    const message = render(input({ items, counts }));
    const starts = blockStarts(message.text);
    expect(starts.map((line) => line.split(" ")[1])).toEqual(["🔴", "✉️", "❓", "ℹ️", "🔔", "🚫"]);
    expect(starts.map((line) => line.slice(0, 2))).toEqual(["1.", "2.", "3.", "4.", "5.", "6."]);
    expect(message.text).toContain("NEEDS ACTION · 3");
    expect(message.text).toContain("OTHER MAIL · 3");
    expect(message.text).toContain("Since 5 Nov 16:00: 6 mails, 3 need action");
    expect(message.text).toContain("Shadow mode: the system changed nothing in your mailbox.");
    expect(message.buttons[1]?.map((b) => b.text)).toEqual(["✏️ 3", "✅ 4", "✏️ 4"]);
  });

  test("undoable items get a third button; unsure keeps edit and undo", () => {
    const items = [item(1, "urgent", { undoable: true }), item(2, "unsure", { undoable: true }), item(3, "info")];
    const message = render(input({ items, counts: { urgent: 1, info: 1, unsure: 1 } }));
    const urgent = message.buttons[0]?.slice(0, 3).map((b) => b.data);
    expect(urgent).toEqual([`fr:u:${uuid(1)}`, `fe:${uuid(1)}`, `fu:${uuid(1)}`]);
    expect(message.buttons[0]?.map((b) => b.text)).toEqual(["✅ 1", "✏️ 1", "↩️ 1", "✏️ 2", "↩️ 2"]);
    expect(message.buttons[0]?.slice(3).map((b) => b.data)).toEqual([`fe:${uuid(2)}`, `fu:${uuid(2)}`]);
    expect(message.buttons[1]?.map((b) => b.text)).toEqual(["✅ 3", "✏️ 3"]);
  });

  test("15 undoable lines give 45 buttons in 8 rows within the limits", () => {
    const items = Array.from({ length: 15 }, (_, i) => item(i + 1, "urgent", { undoable: true }));
    const message = render(input({ items, counts: { urgent: 15 } }));
    expect(message.buttons).toHaveLength(8);
    expect(message.buttons.flat()).toHaveLength(45);
    expect(message.buttons.every((row) => row.length <= 6)).toBe(true);
    for (const button of message.buttons.flat()) expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
  });

  test("lists 15 of 20 items with +N more and button rows", () => {
    const categories: Category[] = ["urgent", "needs_reply", "info", "notification"];
    const items = Array.from({ length: 20 }, (_, i) => item(i + 1, categories[i % 4] as Category));
    const counts = { urgent: 5, needs_reply: 5, info: 5, notification: 5 };
    const message = render(input({ items, counts }));
    expect(blockStarts(message.text)).toHaveLength(DIGEST_MAX_LINES);
    expect(message.text).toContain("+5 more: 5 notification");
    expect(message.buttons).toHaveLength(8);
    expect(message.buttons[7]?.map((b) => b.text)).toEqual(["✅ 15", "✏️ 15"]);
  });

  test("+N more lists every overflowing category in order", () => {
    const categories: Category[] = ["urgent", "needs_reply", "unsure", "info", "notification", "spam"];
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1, categories[i % 6] as Category));
    const counts = { urgent: 5, needs_reply: 5, unsure: 5, info: 5, notification: 5, spam: 5 };
    const message = render(input({ items, counts }));
    expect(blockStarts(message.text)).toHaveLength(DIGEST_MAX_LINES);
    expect(message.text).toContain("+15 more: 5 info, 5 notification, 5 spam");
  });

  test("+N more subtracts only the listed items from the counts", () => {
    const items = [item(1, "urgent"), item(2, "urgent"), item(3, "info")];
    const message = render(input({ items, counts: { urgent: 10, info: 4 } }));
    expect(blockStarts(message.text)).toHaveLength(3);
    expect(message.text).toContain("+11 more: 8 urgent, 3 info");
  });

  test("worst case stays within 4096 and drops items into +N more", () => {
    const long = "😀".repeat(1000);
    const items = Array.from({ length: 15 }, (_, i) =>
      item(i + 1, "urgent", {
        from: "f".repeat(300),
        subject: long,
        aiText: "a".repeat(2000),
        wouldDo: "would mark read, move to AI/Notifications",
      })
    );
    const mailboxes = Array.from({ length: 10 }, (_, i) => ({
      ...mailbox,
      id: `m${i}`,
      address: `${String(i).repeat(60)}`,
    }));
    const message = render(input({ items, counts: { urgent: 15 }, mailboxes }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const shown = blockStarts(message.text).length;
    expect(shown).toBeLessThan(15);
    expect(message.buttons.flat()).toHaveLength(shown * 2);
    expect(message.text).toContain(`+${15 - shown} more: ${15 - shown} urgent`);
    for (const button of message.buttons.flat()) {
      expect(items.some((i) => i.emailId === emailIdOf(button.data))).toBe(true);
      expect(Number.parseInt(button.text.split(" ")[1] as string, 10)).toBeLessThanOrEqual(shown);
    }
  });

  test("cuts the text when even no item fits", () => {
    const mailboxes = Array.from({ length: 100 }, (_, i) => ({ ...mailbox, id: `m${i}`, address: "x".repeat(60) }));
    const message = render(input({ mailboxes }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text.endsWith("…")).toBe(true);
    expect(message.buttons).toEqual([]);
  });

  test("maxLines limits the blocks", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(i + 1, "info"));
    const message = render(input({ items, counts: { info: 6 }, maxLines: 3 }));
    expect(blockStarts(message.text)).toHaveLength(3);
    expect(message.text).toContain("+3 more: 3 info");
  });

  test("headers", () => {
    expect(render(input({ slot: { ...slot, late: true } })).text.split("\n")[0]).toBe(
      "📬 Digest 08:00 · Fri 6 Nov (late)"
    );
    const lateNight = render(
      input({ slot: { date: "2026-11-06", time: "23:30", late: true }, now: new Date("2026-11-06T23:10:00Z") })
    );
    expect(lateNight.text.split("\n")[0]).toBe("📬 Digest 23:30 · Fri 6 Nov (late)");
    const onDemand = render(input({ kind: "on_demand", slot: null, now: new Date("2026-11-06T13:05:00Z") }));
    expect(onDemand.text.split("\n")[0]).toBe("📬 Digest now · Fri 6 Nov 14:05");
  });

  test("mailbox lines", () => {
    const line = (box: Partial<DigestMailbox>): string =>
      render(input({ mailboxes: [{ ...mailbox, ...box }] })).text.split("\n")[2] as string;
    expect(line({ lastSyncedAt: new Date("2026-11-06T06:20:00Z") })).toBe("⚠️ Last sync 07:20 (late)");
    expect(line({ lastSyncedAt: null })).toBe("⚠️ Last sync: never");
    expect(
      line({
        status: "paused",
        statusChangedAt: new Date("2026-11-05T13:00:00Z"),
        lastSyncedAt: new Date("2026-11-05T12:55:00Z"),
      })
    ).toBe("⏸ Paused since 5 Nov 14:00 · last sync 5 Nov 13:55");
    expect(
      line({
        status: "auth_error",
        statusChangedAt: new Date("2026-11-06T06:40:00Z"),
        lastSyncedAt: new Date("2026-11-06T06:35:00Z"),
      })
    ).toBe("❌ Login error since 07:40 · last sync 07:35");
    const two = render(
      input({ mailboxes: [mailbox, { ...mailbox, id: "m2", address: "other@firma.test" }] })
    ).text.split("\n");
    expect(two[2]).toBe("🔄 Last sync 07:55 · boss@firma.test");
    expect(two[3]).toBe("🔄 Last sync 07:55 · other@firma.test");
    expect(render(input({ mailboxes: [] })).text).toContain("Last sync: no mailbox connected");
  });

  test("synthetic item is marked", () => {
    const message = render(input({ items: [item(1, "info", { synthetic: true })], counts: { info: 1 } }));
    expect(blockStarts(message.text)[0]?.endsWith("· 🧪 test")).toBe(true);
  });

  test("a folder tag shows the folder after the sender", () => {
    const tagged = render(input({ items: [item(1, "info", { folderTag: "Oferty" })], counts: { info: 1 } }));
    expect(blockStarts(tagged.text)[0]?.endsWith("· 📁 Oferty")).toBe(true);
    const plain = render(input({ items: [item(1, "info")], counts: { info: 1 } }));
    expect(blockStarts(plain.text)[0]).not.toContain("📁");
    const long = render(input({ items: [item(1, "info", { folderTag: "F".repeat(45) })], counts: { info: 1 } }));
    expect(blockStarts(long.text)[0]).toContain(`· 📁 ${cutText("F".repeat(45), 30)}`);
    expect(blockStarts(long.text)[0]).not.toContain("F".repeat(31));
  });

  test("footer lines for skipped and waiting mail", () => {
    const some = render(input({ skippedTooOld: 1, waiting: 2 })).text;
    expect(some).toContain("📭 Not processed (older than 7 days): 1");
    expect(some).toContain("⏳ Waiting for triage: 2");
    const none = render(input()).text;
    expect(none).not.toContain("📭");
    expect(none).not.toContain("⏳");
  });

  test("backlog skips have their own footer line after the too-old line", () => {
    const text = render(input({ skippedTooOld: 2, skippedBacklog: 3 })).text;
    const tooOld = text.indexOf("📭 Not processed (older than 7 days): 2");
    const backlog = text.indexOf("📭 Not processed (from the account pause): 3");
    expect(tooOld).toBeGreaterThanOrEqual(0);
    expect(backlog).toBeGreaterThan(tooOld);
    expect(render(input({ skippedTooOld: 2, skippedBacklog: 0 })).text).not.toContain("from the account pause");
  });

  test("no shadow line in assist mode", () => {
    const message = render(
      input({ mailboxes: [{ ...mailbox, mode: "assist" }], items: [item(1, "info")], counts: { info: 1 } })
    );
    expect(message.text).not.toContain("Shadow mode");
  });

  test("no shadow line for a mailbox without settings", () => {
    const message = render(
      input({ mailboxes: [{ ...mailbox, mode: "none" }], items: [item(1, "info")], counts: { info: 1 } })
    );
    expect(message.text).not.toContain("Shadow mode");
  });

  test("no shadow line without a mailbox", () => {
    const message = render(input({ mailboxes: [], items: [item(1, "info")], counts: { info: 1 } }));
    expect(message.text).not.toContain("Shadow mode");
  });

  test("button data is short and parses to the e-mail id", () => {
    const items = [item(1, "urgent"), item(2, "unsure"), item(3, "spam")];
    const message = render(input({ items, counts: { urgent: 1, unsure: 1, spam: 1 } }));
    for (const button of message.buttons.flat()) {
      expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
      expect(items.map((i) => i.emailId)).toContain(emailIdOf(button.data) as string);
    }
  });

  test("no 💬 line when aiText is null", () => {
    const message = render(input({ items: [item(1, "info", { aiText: null })], counts: { info: 1 } }));
    expect(message.text).not.toContain("💬");
  });
});

describe("delegations footer", () => {
  test("shows the counts after the other footer lines and before the shadow line", () => {
    const text = render(
      input({ items: [item(1, "info")], counts: { info: 1 }, waiting: 2, delegations: { open: 3, overdue: 1 } })
    ).text;
    expect(text).toContain("👥 Delegations: 3 waiting for a reply, 1 overdue");
    expect(text.indexOf("⏳ Waiting for triage: 2")).toBeLessThan(text.indexOf("👥 Delegations"));
    expect(text.indexOf("👥 Delegations")).toBeLessThan(text.indexOf("Shadow mode"));
  });

  test("shows when only one count is above 0; absent when both are 0 or missing", () => {
    expect(render(input({ delegations: { open: 0, overdue: 2 } })).text).toContain(
      "👥 Delegations: 0 waiting for a reply, 2 overdue"
    );
    expect(render(input({ delegations: { open: 0, overdue: 0 } })).text).not.toContain("Delegations");
    expect(render(input()).text).not.toContain("Delegations");
  });
});

describe("renderDigest in Polish", () => {
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
