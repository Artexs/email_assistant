import { describe, expect, test } from "bun:test";

import { textTables, type CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { parseCallback } from "./callback";
import { isCallbackOfFamily } from "./callback-kinds";
import {
  DIGEST_MAX_LINES,
  renderDigestWithBrief,
  type DigestInput,
  type DigestItem,
  type DigestMailbox,
} from "./digest";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";
import { cutText } from "./text";
import { describeActions, type ActionView } from "./would-do";

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

function act(type: ActionView["type"], status: string): ActionView {
  return {
    id: "a1",
    type,
    status,
    folder: null,
    reverse: false,
    reversesActionId: null,
    appliedAt: null,
    kind: null,
    delegateId: null,
  };
}

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

describe("the Draft reply button of a digest row", () => {
  const rowData = (message: OutMessage) => message.buttons.map((row) => row.map((button) => button.data));

  test("a draftable row gets ✍️ n with the mail id; a row without the field has none (en and pl)", () => {
    const items = [item(1, "needs_reply", { draftable: true }), item(2, "needs_reply")];
    const en = renderDigestWithBrief(input({ counts: { needs_reply: 2 }, items }), textTables.en).message;
    const all = en.buttons.flat();
    const draft = all.filter((button) => button.data === `dr:${uuid(1)}`);
    expect(draft).toHaveLength(1);
    expect(draft[0]?.text).toMatch(/^✍️ [12]$/);
    expect(all.some((button) => button.data === `dr:${uuid(2)}`)).toBe(false);
    const pl = renderDigestWithBrief(
      input({ counts: { needs_reply: 1 }, items: [items[0] as DigestItem] }),
      textTables.pl
    ).message;
    expect(pl.buttons.flat().some((button) => button.data === `dr:${uuid(1)}`)).toBe(true);
  });

  test("a keyboard row holds at most 8 buttons: two rows with the draft button do not share one line", () => {
    const items = [
      item(1, "needs_reply", { draftable: true, delegable: true, undoable: true }),
      item(2, "needs_reply", { draftable: true, delegable: true, undoable: true }),
    ];
    const message = renderDigestWithBrief(input({ counts: { needs_reply: 2 }, items }), textTables.en).message;
    for (const row of rowData(message)) expect(row.length).toBeLessThanOrEqual(8);
    expect(message.buttons.length).toBe(2);
  });

  test("without the field the keyboard is the one of before: two mails share one line", () => {
    const items = [item(1, "needs_reply"), item(2, "needs_reply")];
    const message = renderDigestWithBrief(input({ counts: { needs_reply: 2 }, items }), textTables.en).message;
    expect(message.buttons).toHaveLength(1);
  });
});

describe("suspicious warning", () => {
  test("a flagged item shows the warning after the AI line; a flagged delegation shows no draft instead of the would-do line", () => {
    const items = [
      item(1, "urgent", { suspicious: ["lookalike_domain", "risky_attachment"] }),
      item(2, "delegation", { suspicious: ["link_mismatch"], wouldDo: "would draft a delegation to Anna" }),
    ];
    const lines = renderDigestWithBrief(
      input({ counts: { urgent: 1, delegation: 1 }, items }),
      textTables.en
    ).message.text.split("\n");
    const first = lines.indexOf("💬 AI text 1");
    expect(lines.slice(first, first + 3)).toEqual([
      "💬 AI text 1",
      "⚠ Suspicious: look-alike domain, risky attachment",
      "→ would flag",
    ]);
    const second = lines.indexOf("💬 AI text 2");
    expect(lines.slice(second, second + 3)).toEqual([
      "💬 AI text 2",
      "⚠ Suspicious: link goes elsewhere",
      "→ no draft: suspicious mail",
    ]);
    expect(lines.join("\n")).not.toContain("draft a delegation");
    const pl = renderDigestWithBrief(
      input({ counts: { delegation: 1 }, items: [items[1] as DigestItem] }),
      textTables.pl
    ).message.text;
    expect(pl).toContain("⚠ Podejrzana wiadomość: link prowadzi gdzie indziej\n→ bez szkicu: podejrzana wiadomość");
  });

  test("a flagged delegation that has a draft keeps its would-do line", () => {
    const flagged = item(1, "delegation", {
      suspicious: ["link_mismatch"],
      hasDraft: true,
      wouldDo: "would draft a delegation to Anna",
    });
    const text = renderDigestWithBrief(input({ counts: { delegation: 1 }, items: [flagged] }), textTables.en).message
      .text;
    expect(text).toContain("⚠ Suspicious: link goes elsewhere\n→ would draft a delegation to Anna");
    expect(text).not.toContain("no draft");
  });

  test("an item without the field, or with an empty list, renders as before", () => {
    const plain = [item(1, "urgent"), item(2, "delegation")];
    const before = renderDigestWithBrief(
      input({ counts: { urgent: 1, delegation: 1 }, items: plain }),
      textTables.en
    ).message;
    const empty = plain.map((one) => ({ ...one, suspicious: [] }));
    expect(
      renderDigestWithBrief(input({ counts: { urgent: 1, delegation: 1 }, items: empty }), textTables.en).message
    ).toEqual(before);
    expect(before.text).not.toContain("⚠");
    expect(before.text).not.toContain("no draft");
  });

  test("a flagged item of another category keeps its would-do line", () => {
    const text = renderDigestWithBrief(
      input({ counts: { info: 1 }, items: [item(1, "info", { suspicious: ["auth_fail"] })] }),
      textTables.en
    ).message.text;
    expect(text).toContain("⚠ Suspicious: sender check failed\n→ would flag");
  });
});

describe("attachment line", () => {
  const attachments = {
    attachments: [{ name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false }],
    count: 1,
  };

  test("an item with attachments shows the line after the subject, before the AI line", () => {
    const lines = renderDigestWithBrief(
      input({ counts: { urgent: 1 }, items: [item(1, "urgent", { attachments })] }),
      textTables.en
    ).message.text.split("\n");
    const first = lines.indexOf("📎 1: faktura.pdf (120 kB)");
    expect(first).toBeGreaterThan(0);
    expect(lines[first + 1]).toBe("💬 AI text 1");
  });

  test("an item without the field renders as before", () => {
    const before = renderDigestWithBrief(
      input({ counts: { urgent: 1 }, items: [item(1, "urgent")] }),
      textTables.en
    ).message;
    expect(before.text).not.toContain("📎");
  });
});

describe("why lines (F110 stage 16)", () => {
  const lineOf = (text: string, start: string): string => text.split("\n").find((line) => line.startsWith(start)) ?? "";
  const one = (extra: Partial<DigestItem>, category: Category = "info", texts: CoreTexts = textTables.en): string =>
    render(input({ counts: { [category]: 1 }, items: [item(1, category, extra)] }), texts).text;

  test("1. confidence 0.87 and no rule: the percent after the AI text", () => {
    expect(lineOf(one({ confidence: 0.87, rule: null }), "💬")).toBe("💬 AI text 1 · 85%");
  });

  test("2. the percent rounds down to a multiple of 5, a zero percent is not shown", () => {
    expect(lineOf(one({ confidence: 0.7 }), "💬")).toBe("💬 AI text 1 · 70%");
    expect(lineOf(one({ confidence: 0.999 }), "💬")).toBe("💬 AI text 1 · 95%");
    expect(lineOf(one({ confidence: 1 }), "💬")).toBe("💬 AI text 1 · 100%");
    expect(lineOf(one({ confidence: 0.29 }), "💬")).toBe("💬 AI text 1 · 25%");
    expect(lineOf(one({ confidence: 0.04 }), "💬")).toBe("💬 AI text 1");
    expect(lineOf(one({ confidence: null }), "💬")).toBe("💬 AI text 1");
  });

  test("3. a rule replaces the percent", () => {
    expect(lineOf(one({ confidence: 0.9, rule: "vip" }), "💬")).toBe("💬 AI text 1 · rule: VIP sender");
    expect(lineOf(one({ confidence: 0.9, rule: "whitelist" }), "💬")).toBe("💬 AI text 1 · rule: whitelisted sender");
    expect(lineOf(one({ confidence: 1, rule: "blocklist" }, "spam"), "💬")).toBe("💬 AI text 1 · rule: blocked sender");
  });

  test("4. an item without the keys renders as today", () => {
    const lines = one({}).split("\n");
    const first = lines.indexOf("1. ℹ️ Info · Ann1 <ann1@firma.test>");
    expect(lines.slice(first, first + 4)).toEqual([
      "1. ℹ️ Info · Ann1 <ann1@firma.test>",
      "Subject 1",
      "💬 AI text 1",
      "→ would flag",
    ]);
    expect(one({ confidence: null, rule: null })).toBe(one({}));
  });

  test("5. the tags sit next to the delegate name in the would-do line, not after the send state", () => {
    const names = new Map([["d1", "Anna Nowak"]]);
    const actions = [
      { ...act("create_draft", "ready"), kind: "delegation" as const, delegateId: "d1" },
      act("send", "awaiting_approval"),
    ];
    const wouldDo = (texts: CoreTexts, withTags: boolean): string =>
      describeActions(
        actions,
        names,
        withTags ? { delegateTags: new Map([["d1", ["finance", "legal", "hr", "it"]]]) } : {},
        texts
      );
    const en = lineOf(one({ wouldDo: wouldDo(textTables.en, true) }, "delegation"), "→");
    expect(en).toBe("→ will draft a delegation to Anna Nowak (skills: finance, legal, hr); waits for your approval");
    // No tags: the line of today.
    expect(lineOf(one({ wouldDo: wouldDo(textTables.en, false) }, "delegation"), "→")).toBe(
      "→ will draft a delegation to Anna Nowak; waits for your approval"
    );
  });

  test("6. the Polish texts", () => {
    expect(lineOf(one({ confidence: 0.87 }, "info", textTables.pl), "💬")).toBe("💬 AI text 1 · 85%");
    expect(lineOf(one({ rule: "vip" }, "info", textTables.pl), "💬")).toBe("💬 AI text 1 · reguła: nadawca VIP");
    expect(lineOf(one({ rule: "whitelist" }, "info", textTables.pl), "💬")).toContain(
      "reguła: nadawca z listy dozwolonych"
    );
    expect(lineOf(one({ rule: "blocklist" }, "spam", textTables.pl), "💬")).toContain(
      "reguła: nadawca z listy blokowanych"
    );
  });

  test("7. 15 items with all suffixes and an attachment line each stay listed within the limit", () => {
    const attachments = {
      attachments: [{ name: "faktura-listopad.pdf", type: "application/pdf", size: 122880, inline: false }],
      count: 1,
    };
    const categories: Category[] = ["urgent", "needs_reply", "delegation"];
    for (const texts of [textTables.en, textTables.pl]) {
      const items = Array.from({ length: 15 }, (_, index) => {
        const category = categories[index % 3] as Category;
        return item(index + 1, category, {
          attachments,
          confidence: 0.85,
          rule: index % 5 === 0 ? "vip" : null,
          // Only a delegation item has a draft, so only its line holds the tags.
          wouldDo:
            category === "delegation"
              ? describeActions(
                  [
                    { ...act("create_draft", "ready"), kind: "delegation", delegateId: "d1" },
                    act("send", "awaiting_approval"),
                  ],
                  new Map([["d1", "Anna Kowalska"]]),
                  { delegateTags: new Map([["d1", ["finance", "legal", "human resources"]]]) },
                  texts
                )
              : "would flag",
          aiText: "Asks for the signed contract before Friday noon",
        });
      });
      const message = render(input({ counts: { urgent: 5, needs_reply: 5, delegation: 5 }, items }), texts);
      expect(blockStarts(message.text)).toHaveLength(15);
      expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    }
  });

  test("8. an item without AI text gets its own line; an unsure item shows one percent only", () => {
    expect(lineOf(one({ aiText: null, confidence: 0.8 }), "💬")).toBe("💬 80%");
    expect(lineOf(one({ aiText: null, rule: "vip" }), "💬")).toBe("💬 rule: VIP sender");
    expect(one({ aiText: null })).not.toContain("💬");
    const unsure = one({ aiText: "Not sure (maybe info, 55%)", confidence: 0.55 }, "unsure");
    expect(lineOf(unsure, "💬")).toBe("💬 Not sure (maybe info, 55%)");
    expect(lineOf(one({ aiText: "Not sure", confidence: 0.55, rule: "whitelist" }, "unsure"), "💬")).toBe(
      "💬 Not sure · rule: whitelisted sender"
    );
    expect(lineOf(one({ aiText: null, confidence: 0.55 }, "unsure"), "💬")).toBe("");
  });

  test("N2. with the longest fields the flag on may list up to 3 fewer items than the flag off (accepted, en 7 against 10), never fewer than 7", () => {
    const attachments = {
      attachments: [{ name: "n".repeat(40), type: "application/pdf", size: 122880, inline: false }],
      count: 1,
    };
    for (const texts of [textTables.en, textTables.pl]) {
      const items = (on: boolean): DigestItem[] =>
        Array.from({ length: 15 }, (_, index) =>
          item(index + 1, "delegation", {
            from: "f".repeat(60),
            subject: "s".repeat(120),
            attachments,
            aiText: "a".repeat(200),
            wouldDo: describeActions(
              [
                { ...act("create_draft", "ready"), kind: "delegation", delegateId: "d1" },
                act("send", "awaiting_approval"),
              ],
              new Map([["d1", "Anna Nowak"]]),
              on ? { delegateTags: new Map([["d1", ["t".repeat(40), "u".repeat(40), "v".repeat(40)]]]) } : {},
              texts
            ),
            ...(on ? { confidence: 0.85, rule: index % 2 === 0 ? "whitelist" : null } : {}),
          })
        );
      const listed = (on: boolean): number =>
        blockStarts(render(input({ counts: { delegation: 15 }, items: items(on) }), texts).text).length;
      expect(listed(true)).toBeLessThanOrEqual(listed(false));
      expect(listed(false) - listed(true)).toBeLessThanOrEqual(3);
      expect(listed(true)).toBeGreaterThanOrEqual(7);
    }
  });

  test("TG2. an empty AI text with a mark gives the mark line; without a mark the digest prints no line", () => {
    expect(lineOf(one({ aiText: "", confidence: 0.8 }), "💬")).toBe("💬 80%");
    expect(lineOf(one({ aiText: "", rule: "vip" }), "💬")).toBe("💬 rule: VIP sender");
    expect(one({ aiText: "" })).not.toContain("💬");
    expect(one({ aiText: "", confidence: null, rule: null })).not.toContain("💬");
  });

  test("a long AI text is cut before the mark, so the mark stays", () => {
    expect(lineOf(one({ aiText: "y".repeat(300), confidence: 0.9 }), "💬")).toBe(`💬 ${"y".repeat(119)}… · 90%`);
  });
});

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
const render = (digest: DigestInput, texts: CoreTexts = textTables.en): OutMessage =>
  renderDigestWithBrief(digest, texts).message;

const blockStarts = (text: string): string[] => text.split("\n").filter((line) => /^\d+\. /.test(line));

function emailIdOf(data: string): string | undefined {
  const parsed = parseCallback(data);
  return parsed !== null && isCallbackOfFamily(parsed, "feedback") ? parsed.emailId : undefined;
}

describe("handled share line", () => {
  const handledInput = (handled: DigestInput["handled"]): DigestInput => input({ handled });

  test("5. shows the share after the other footer lines; shadow mode shows the would-handle share", () => {
    const share = { handled: 124, wouldHandle: 0, triaged: 200, shadowOnly: false };
    const text = render(handledInput(share)).text;
    expect(text).toContain("🤖 Handled in the last 7 days: 62% (124 of 200)");
    const shadow = { handled: 0, wouldHandle: 50, triaged: 200, shadowOnly: true };
    expect(render(handledInput(shadow)).text).toContain("🤖 Would handle in the last 7 days: 25% (50 of 200)");
    // Shadow mode with handled mail shows the handled share.
    expect(render(handledInput({ ...shadow, handled: 10 })).text).toContain("Handled in the last 7 days: 5%");
    expect(render(handledInput({ ...share, triaged: 0 })).text).not.toContain("🤖");
    expect(render(input()).text).not.toContain("🤖");
  });

  test("the share is the last footer line, after the pause line (the first) and the shadow line", () => {
    const text = render(
      input({
        items: [item(1, "info")],
        counts: { info: 1 },
        waiting: 2,
        llmPause: { code: "timeout", since: new Date("2026-11-06T06:30:00Z") },
        handled: { handled: 124, wouldHandle: 0, triaged: 200, shadowOnly: false },
      })
    ).text;
    const footer = text.split("\n").slice(text.split("\n").lastIndexOf("") + 1);
    expect(footer[0]).toContain("LLM paused");
    expect(footer.at(-2)).toContain("Shadow mode");
    expect(footer.at(-1)).toBe("🤖 Handled in the last 7 days: 62% (124 of 200)");
  });

  test("the Polish line uses the Polish number word", () => {
    const share = { handled: 124, wouldHandle: 0, triaged: 200, shadowOnly: false };
    expect(render(handledInput(share), textTables.pl).text).toContain("62% (124 z 200)");
  });
});

describe("replies ready line ", () => {
  test("one footer line with the count, en and pl, no button; 0 or absent: no line", () => {
    const one = render(input({ repliesReady: 1 }));
    expect(one.text).toContain("📝 1 reply ready");
    expect(one.buttons).toEqual([]);
    expect(render(input({ repliesReady: 7 })).text).toContain("📝 7 replies ready");
    expect(render(input({ repliesReady: 7 }), textTables.pl).text).toContain("📝 Szkice odpowiedzi do przejrzenia: 7");
    expect(render(input({ repliesReady: 0 })).text).not.toContain("📝");
    expect(render(input()).text).not.toContain("📝");
  });

  test("the line is in the footer, before the shadow line", () => {
    const text = render(input({ items: [item(1, "info")], counts: { info: 1 }, repliesReady: 2 })).text;
    const lines = text.split("\n");
    expect(lines.indexOf("📝 2 replies ready")).toBeGreaterThan(lines.lastIndexOf(""));
    expect(lines.at(-1)).toContain("Shadow mode");
    expect(lines.at(-2)).toBe("📝 2 replies ready");
  });
});

describe("renderDigestWithBrief (no brief)", () => {
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
    expect(
      line({
        status: "host_blocked",
        statusChangedAt: new Date("2026-11-06T06:40:00Z"),
        lastSyncedAt: new Date("2026-11-06T06:35:00Z"),
      })
    ).toBe("⛔ Mail server not allowed since 07:40 · last sync 07:35");
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

describe("spam review line (F110 stage 17)", () => {
  const url = "https://panel.test/activity?category=spam";
  const spam = (extra: Partial<NonNullable<DigestInput["spamReview"]>> = {}): DigestInput["spamReview"] => ({
    moved: 3,
    wouldMove: 0,
    url,
    ...extra,
  });
  const lines = (digest: DigestInput, texts: CoreTexts = textTables.en): string[] =>
    render(digest, texts).text.split("\n");

  test("1. n = 3 with the URL: the line with the link; without the URL: the panel text", () => {
    expect(lines(input({ spamReview: spam() }))).toContain(`🗑 3 went to spam · review: ${url}`);
    expect(lines(input({ spamReview: spam({ url: null }) }))).toContain("🗑 3 went to spam · check them in the panel");
  });

  test("2. n = 0 or no field: no line", () => {
    for (const spamReview of [spam({ moved: 0 }), undefined]) {
      const text = render(input(spamReview === undefined ? {} : { spamReview })).text;
      expect(text).not.toContain("🗑");
      expect(text).not.toContain("spam");
    }
  });

  test("4. logged moves of a shadow mailbox read 'would have gone to spam'; both counts give both lines", () => {
    expect(lines(input({ spamReview: spam({ moved: 0, wouldMove: 2 }) }))).toContain(
      `🗑 2 would have gone to spam · review: ${url}`
    );
    const both = lines(input({ spamReview: spam({ moved: 1, wouldMove: 2 }) }));
    expect(both).toContain(`🗑 1 went to spam · review: ${url}`);
    expect(both).toContain(`🗑 2 would have gone to spam · review: ${url}`);
  });

  test("6. the Polish texts follow the number", () => {
    const pl = (extra: Partial<NonNullable<DigestInput["spamReview"]>>): string[] =>
      lines(input({ spamReview: spam(extra) }), textTables.pl);
    expect(pl({ moved: 1 })).toContain(`🗑 1 wiadomość trafiła do spamu · sprawdź: ${url}`);
    expect(pl({ moved: 3 })).toContain(`🗑 3 wiadomości trafiły do spamu · sprawdź: ${url}`);
    expect(pl({ moved: 5 })).toContain(`🗑 5 wiadomości trafiło do spamu · sprawdź: ${url}`);
    expect(pl({ moved: 3, url: null })).toContain("🗑 3 wiadomości trafiły do spamu · sprawdź w panelu");
    expect(pl({ moved: 0, wouldMove: 1 })).toContain(`🗑 1 wiadomość trafiłaby do spamu · sprawdź: ${url}`);
    expect(pl({ moved: 0, wouldMove: 2 })).toContain(`🗑 2 wiadomości trafiłyby do spamu · sprawdź: ${url}`);
    expect(pl({ moved: 0, wouldMove: 7 })).toContain(`🗑 7 wiadomości trafiłoby do spamu · sprawdź: ${url}`);
  });

  test("the line is a footer line: after the shadow line, before the handled share", () => {
    const rows = lines(
      input({
        items: [item(1, "info")],
        counts: { info: 1 },
        waiting: 2,
        spamReview: spam(),
        handled: { handled: 124, wouldHandle: 0, triaged: 200, shadowOnly: false },
      })
    );
    const at = (part: string): number => rows.findIndex((row) => row.includes(part));
    expect(at("⏳ Waiting")).toBeLessThan(at("Shadow mode"));
    expect(at("Shadow mode")).toBeLessThan(at("🗑"));
    expect(at("🗑")).toBe(at("🤖") - 1);
    expect(rows.at(-1)).toContain("🤖");
  });

  test("a full digest drops the line before any item row", () => {
    // Find an item size at which all 15 rows fit without the line but not with it.
    let found = false;
    for (let size = 40; size <= 400 && !found; size += 1) {
      const items = Array.from({ length: 15 }, (_, i) =>
        item(i + 1, "urgent", { subject: "s".repeat(size), aiText: "a".repeat(size) })
      );
      const plain = render(input({ items, counts: { urgent: 15 } }));
      const withLine = render(input({ items, counts: { urgent: 15 }, spamReview: spam() }));
      if (blockStarts(plain.text).length === 15 && !withLine.text.includes("🗑")) {
        found = true;
        expect(withLine.text).toBe(plain.text);
      }
    }
    expect(found).toBe(true);
  });
});

describe("LLM pause footer line", () => {
  const pause = { code: "http_429_quota", since: new Date("2026-11-06T06:30:00Z") };
  const line = "⏸ LLM paused since 07:30: the provider quota or budget is spent (http_429_quota). Triage waits.";

  test("the line is the first footer line", () => {
    const text = render(
      input({ items: [item(1, "info")], counts: { info: 1 }, waiting: 2, skippedTooOld: 1, llmPause: pause })
    ).text;
    const lines = text.split("\n");
    expect(lines).toContain(line);
    expect(lines.indexOf(line)).toBe(lines.indexOf("📭 Not processed (older than 7 days): 1") - 1);
    expect(lines.indexOf(line)).toBeGreaterThan(lines.indexOf(""));
  });

  test("a digest with nothing else in the footer shows the line after one blank line", () => {
    const text = render(input({ llmPause: { code: "timeout", since: new Date("2026-11-06T06:30:00Z") } })).text;
    expect(text.endsWith("\n\n⏸ LLM paused since 07:30 (timeout). Triage waits.")).toBe(true);
  });

  test("without a pause the text does not change", () => {
    const base = input({ waiting: 2 });
    expect(render({ ...base, llmPause: undefined }).text).toBe(render(base).text);
    expect(render(base).text).not.toContain("⏸ LLM");
  });
});

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
