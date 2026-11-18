import { describe, expect, test } from "bun:test";

import { encodeCallback } from "../digest/callback";
import { renderDigestWithBrief } from "../digest/digest";
import { CALLBACK_MAX_BYTES } from "../digest/message";

import {
  briefKeyboard,
  dropLastLine,
  loopSections,
  renderBriefLines,
  type BriefDelegation,
  type BriefInput,
  type BriefSections,
} from "./brief";
import {
  briefInput,
  digestInput,
  digestItem,
  loop,
  mail,
  NOW,
  part,
  textTables,
  uuid,
  ZONE,
} from "./brief-fixtures.test-helper";

// The keyboard of the brief lines and the line numbers that the tap edit needs.
const en = textTables.en;
const pl = textTables.pl;

const delegation = (n: number, over: Partial<BriefDelegation> = {}): BriefDelegation => ({
  id: uuid(300 + n),
  delegateName: "Marta",
  subject: "Umowa najmu",
  sentAt: new Date("2026-11-17T09:00:00Z"),
  dueAt: new Date("2026-11-19T09:00:00Z"),
  closable: true,
  ...over,
});

const rowsOf = (input: BriefInput, texts = en, consent = true, owner = true) =>
  briefKeyboard(loopSections(input), texts, { consent, owner }).map((row) => row.map((button) => button.data));

describe("the rows of the brief keyboard", () => {
  test("one row per loop line: waiting Draft, Later, Done; promised Done, Drop; stale Reopen; an overdue delegation Done", () => {
    const waiting = loop(1);
    const delegated = loop(2, { kind: "delegated" });
    const promised = loop(3, { kind: "promised" });
    const rows = rowsOf(
      briefInput({
        waitingLoops: part([waiting, delegated]),
        waitingDelegations: part([delegation(1)]),
        promised: part([promised]),
        stale: part([{ id: uuid(400), subject: "Old offer" }]),
      })
    );
    const code = (kind: Parameters<typeof encodeCallback>[0]["kind"], id: string) =>
      encodeCallback({ kind, loopId: id } as Parameters<typeof encodeCallback>[0]);
    expect(rows).toEqual([
      [code("loop_follow_up", waiting.id), code("loop_later", waiting.id), code("loop_done", waiting.id)],
      [code("loop_follow_up", delegated.id), code("loop_later", delegated.id), code("loop_done", delegated.id)],
      [encodeCallback({ kind: "delegation_done", delegationId: uuid(301) })],
      [code("loop_done", promised.id), code("loop_drop", promised.id)],
      [code("loop_reopen", uuid(400))],
    ]);
  });

  test("a member has no Draft, Drop or Reopen: waiting Later, Done; promised Done; stale no row; a delegation Done (review 19 N3)", () => {
    const waiting = loop(1);
    const delegated = loop(2, { kind: "delegated" });
    const promised = loop(3, { kind: "promised" });
    const rows = rowsOf(
      briefInput({
        waitingLoops: part([waiting, delegated]),
        waitingDelegations: part([delegation(1)]),
        promised: part([promised]),
        stale: part([{ id: uuid(400), subject: "Old offer" }]),
      }),
      en,
      true,
      false
    );
    const code = (kind: Parameters<typeof encodeCallback>[0]["kind"], id: string) =>
      encodeCallback({ kind, loopId: id } as Parameters<typeof encodeCallback>[0]);
    expect(rows).toEqual([
      [code("loop_later", waiting.id), code("loop_done", waiting.id)],
      [code("loop_later", delegated.id), code("loop_done", delegated.id)],
      [encodeCallback({ kind: "delegation_done", delegationId: uuid(301) })],
      [code("loop_done", promised.id)],
    ]);
  });

  test("the Draft button needs canDraft; the Later button goes after the third use; a sent delegation has no button", () => {
    const rows = rowsOf(
      briefInput({
        waitingLoops: part([loop(1, { canDraft: false }), loop(2, { laterCount: 2 }), loop(3, { laterCount: 3 })]),
        waitingDelegations: part([delegation(1, { closable: false })]),
      })
    );
    expect(rows.map((row) => row.map((data) => data.slice(0, 2)))).toEqual([
      ["ll", "lc"],
      ["lf", "ll", "lc"],
      ["lf", "lc"],
    ]);
  });

  test("N5 (review 17): with no consent there is no loop button, also when the sections still hold loop lines", () => {
    const sections = loopSections(
      briefInput({ waitingLoops: part([loop(1)]), promised: part([loop(2, { kind: "promised" })]) })
    );
    expect(briefKeyboard(sections, en, { consent: true, owner: true })).toHaveLength(2);
    expect(briefKeyboard(sections, en, { consent: false, owner: true })).toEqual([]);
    // The sections of an uncovered user hold counts only: the keyboard is empty on its own too.
    expect(rowsOf(briefInput({ waitingLoops: part([loop(1)]) }), en, false)).toEqual([]);
    const uncovered = loopSections(briefInput({ consent: false, waitingLoops: part([loop(1)]) }));
    expect(briefKeyboard(uncovered, en, { consent: true, owner: true })).toEqual([]);
  });

  test("the urgent and the reply lines have no button", () => {
    expect(rowsOf(briefInput({ urgent: part([mail(1)]), reply: part([mail(2)]) }))).toEqual([]);
  });

  test("the labels follow the language of the user", () => {
    const labels = (texts: typeof en) =>
      briefKeyboard(
        loopSections(briefInput({ waitingLoops: part([loop(1)]), promised: part([loop(2, { kind: "promised" })]) })),
        texts,
        {
          consent: true,
          owner: true,
        }
      )
        .flat()
        .map((button) => button.text);
    expect(labels(en)).toEqual(["📝 Draft follow-up", "⏰ Later", "✓ Done", "✓ Done", "✖️ Drop"]);
    expect(labels(pl)).toEqual(["📝 Przypomnienie", "⏰ Później", "✓ Gotowe", "✓ Gotowe", "✖️ Porzuć"]);
  });
});

describe("the keyboard inside the digest", () => {
  const fullBrief = (): BriefInput =>
    briefInput({
      waitingLoops: part([1, 2, 3].map((n) => loop(n))),
      waitingDelegations: part([1, 2].map((n) => delegation(n))),
      promised: part([6, 7, 8, 9, 10].map((n) => loop(n, { kind: "promised" }))),
      stale: part([1, 2, 3, 4, 5].map((n) => ({ id: uuid(500 + n), subject: `Old ${n}` }))),
    });
  const items = Array.from({ length: 15 }, (_, n) =>
    digestItem(n + 1, "needs_reply", { delegable: true, undoable: true })
  );

  test("worst case: at most 100 buttons, 64 bytes each and 8 per row, loop rows first", () => {
    const { message } = renderDigestWithBrief(
      digestInput({
        items,
        counts: { needs_reply: 15 },
        brief: {
          sections: loopSections(fullBrief()),
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    );
    const buttons = message.buttons.flat();
    expect(buttons.length).toBeLessThanOrEqual(100);
    expect(Math.max(...message.buttons.map((row) => row.length))).toBeLessThanOrEqual(8);
    for (const button of buttons) expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    // The first rows belong to the lines of the brief, the last rows to the mail rows.
    expect(message.buttons[0]?.[0]?.data.slice(0, 2)).toBe("lf");
    expect(message.buttons.at(-1)?.some((button) => button.text.startsWith("👥"))).toBe(true);
  });

  test("a mail row holds ✅, ✏️, ↩️ and 👥, in that order, only for a delegable item", () => {
    const { message } = renderDigestWithBrief(
      digestInput({
        items: [items[0] as (typeof items)[number], digestItem(2, "info", { undoable: true })],
        counts: { needs_reply: 1, info: 1 },
      }),
      en
    );
    expect(message.buttons[0]?.map((button) => button.text)).toEqual([
      "✅ 1",
      "✏️ 1",
      "↩️ 1",
      "👥 1",
      "✅ 2",
      "✏️ 2",
      "↩️ 2",
    ]);
  });

  test("lineOf names the line of each loop and delegation of the text; a line that the 4096 cut dropped is not named", () => {
    const sections = loopSections(fullBrief());
    const { message, shown } = renderDigestWithBrief(
      digestInput({ brief: { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null } }),
      en
    );
    const lines = message.text.split("\n");
    const ids = [...shown.surfaced, ...shown.stale, uuid(301), uuid(302)];
    expect(Object.keys(shown.lineOf).sort()).toEqual([...ids].sort());
    for (const [id, at] of Object.entries(shown.lineOf)) {
      expect(lines[at]).toMatch(/^(⏳|🤝|⌛) /u);
      const rendered = renderBriefLines(sections, en, { timeZone: ZONE, now: NOW });
      expect(lines[at]).toBe(rendered.lines[rendered.ids.indexOf(id)]);
    }
    // The 4096 cut moves the last line into "+n more" (`dropLastLine`): its id and its buttons go with it.
    const shorter = dropLastLine(sections) as BriefSections;
    const cut = renderDigestWithBrief(
      digestInput({
        brief: { sections: shorter, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null },
      }),
      en
    );
    expect(Object.keys(cut.shown.lineOf)).toHaveLength(ids.length - 1);
    expect(Object.keys(cut.shown.lineOf)).not.toContain(shown.stale.at(-1) as string);
    expect(cut.message.buttons.flat().some((button) => button.data.endsWith(shown.stale.at(-1) as string))).toBe(false);
  });

  test("lineOf and the keyboard stay right with the spam review line present and absent (F110 stage 17)", () => {
    const sections = loopSections(fullBrief());
    const brief = { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null };
    const base = { brief, items: [digestItem(1, "info")], counts: { info: 1 } };
    const without = renderDigestWithBrief(digestInput(base), en);
    const spamReview = { moved: 2, wouldMove: 0, url: null };
    const withLine = renderDigestWithBrief(digestInput({ ...base, spamReview }), en);
    expect(withLine.message.text).toContain("🗑 2 went to spam");
    expect(without.message.text).not.toContain("🗑");
    expect(Object.keys(without.shown.lineOf).length).toBeGreaterThan(0);
    expect(withLine.shown.lineOf).toEqual(without.shown.lineOf);
    expect(withLine.message.buttons).toEqual(without.message.buttons);
    const rendered = renderBriefLines(sections, en, { timeZone: ZONE, now: NOW });
    for (const result of [without, withLine]) {
      const lines = result.message.text.split("\n");
      for (const [id, at] of Object.entries(result.shown.lineOf)) {
        expect(lines[at]).toBe(rendered.lines[rendered.ids.indexOf(id)]);
      }
    }
    // Over 4096 characters the line goes first: the digest equals the one without it, lineOf and buttons included.
    const long = "x".repeat(400);
    const items = Array.from({ length: 15 }, (_, i) => digestItem(i + 1, "info", { subject: long, aiText: long }));
    const full = { brief, items, counts: { info: 15 } };
    for (let size = 0; size < 400; size += 10) {
      const sized = full.items.map((item) => ({ ...item, subject: "s".repeat(size), aiText: "a".repeat(size) }));
      const plain = renderDigestWithBrief(digestInput({ ...full, items: sized }), en);
      const spam = renderDigestWithBrief(digestInput({ ...full, items: sized, spamReview }), en);
      if (!spam.message.text.includes("🗑") && plain.message.text.length > 3500) {
        expect(spam.message).toEqual(plain.message);
        expect(spam.shown).toEqual(plain.shown);
        return;
      }
    }
    throw new Error("no size dropped the spam review line");
  });

  test("a loop text with a line break cannot move the line numbers: one line per loop", () => {
    const sections = loopSections(
      briefInput({
        waitingLoops: part([loop(1, { text: "first\nsecond", counterpart: "anna\n@example.test" }), loop(2)]),
        promised: part([loop(3, { kind: "promised", text: "third\r\nfourth" })]),
      })
    );
    const { message, shown } = renderDigestWithBrief(
      digestInput({ brief: { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null } }),
      en
    );
    const lines = message.text.split("\n");
    for (const at of Object.values(shown.lineOf)) expect(lines[at]).toMatch(/^(⏳|🤝) /u);
    expect(lines.filter((line) => /^(⏳|🤝) /u.test(line))).toHaveLength(3);
  });

  test("the address of a loop line loses the remains of an escape sequence (review 19 TG2)", () => {
    const sections = loopSections(
      briefInput({ waitingLoops: part([loop(1, { counterpart: "anna\u001b[31m@example.test", text: "send it" })]) })
    );
    const { message } = renderDigestWithBrief(
      digestInput({ brief: { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null } }),
      en
    );
    const line = message.text.split("\n").find((text) => text.startsWith("⏳")) ?? "";
    expect(line).toContain("No answer from anna@example.test since");
    expect(line).not.toContain("[31m");
    expect(line).not.toContain("\u001b");
  });

  test("no brief, no consent, a later digest: no loop row and no lineOf", () => {
    const input = digestInput({ items: [digestItem(1, "info")], counts: { info: 1 } });
    expect(renderDigestWithBrief(input, en).shown.lineOf).toEqual({});
    const later = renderDigestWithBrief(
      {
        ...input,
        brief: {
          sections: null,
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: { waiting: 1, promised: 0 },
        },
      },
      en
    );
    expect(later.shown.lineOf).toEqual({});
    expect(later.message.buttons).toHaveLength(1);
  });
});
