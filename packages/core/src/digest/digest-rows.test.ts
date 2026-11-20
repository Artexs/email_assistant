import { describe, expect, test } from "bun:test";

import { textTables, type CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { renderDigestWithBrief, type DigestItem } from "./digest";
import { uuid, item, input, render, blockStarts } from "./digest.test-helper";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";
import { describeActions, type ActionView } from "./would-do";

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
