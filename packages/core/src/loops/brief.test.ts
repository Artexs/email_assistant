import { describe, expect, test } from "bun:test";

import { renderDigestWithBrief, type DigestInput } from "../digest/digest";
import { MESSAGE_MAX_CHARS } from "../digest/message";
import { withoutEscapeRemains } from "../digest/text";

import {
  BRIEF_SECTION_LINES,
  dropLastLine,
  loopSections,
  renderBrief,
  shownIds,
  type BriefDelegation,
  type BriefInput,
} from "./brief";
import {
  briefInput,
  DAY,
  digestInput,
  digestMailbox,
  digestItem,
  HOUR,
  loop,
  mail,
  NOW,
  part,
  textTables,
  ZONE,
} from "./brief-fixtures.test-helper";

const en = textTables.en;
const pl = textTables.pl;
const opts = { timeZone: ZONE, now: NOW };

const delegation = (n: number, over: Partial<BriefDelegation> = {}): BriefDelegation => ({
  id: `0190a1b2-c3d4-7e5f-8a9b-${(200 + n).toString(16).padStart(12, "0")}`,
  delegateName: "Marta",
  subject: "Umowa najmu",
  sentAt: new Date("2026-11-17T09:00:00Z"),
  dueAt: new Date("2026-11-19T09:00:00Z"),
  closable: true,
  ...over,
});

// The data: 2 urgent, 7 waiting on you, 3 loops, 1 delegation and 1 promise.
function fullInput(over: Partial<BriefInput> = {}): BriefInput {
  return briefInput({
    urgent: part([
      mail(1, { receivedAt: new Date(NOW.getTime() - 2 * HOUR) }),
      mail(2, { receivedAt: new Date(NOW.getTime() - 30 * 60_000) }),
    ]),
    reply: part([1, 2, 3, 4, 5, 6, 7].map((n) => mail(10 + n, { receivedAt: new Date(NOW.getTime() - n * DAY) }))),
    waitingLoops: part([
      loop(1, { counterpart: "anna@example.test", subject: "Offer for Q1" }),
      loop(2, { kind: "delegated", counterpart: "marta@example.test", dueAt: new Date("2026-11-14T09:00:00Z") }),
      loop(3, { dueAt: new Date("2026-11-20T09:00:00Z") }),
    ]),
    waitingDelegations: part([delegation(1)]),
    promised: part([
      loop(4, {
        kind: "promised",
        text: "send the offer",
        dueAt: new Date("2026-11-20T10:00:00Z"),
      }),
    ]),
    ...over,
  });
}

describe("loopSections and renderBrief (T1)", () => {
  test("the four sections in order; ✍️ holds 5 lines and +2; empty sections hide", () => {
    const lines = renderBrief(loopSections(fullInput()), en, opts);
    const marks = lines.filter((line) => /^(🔴|✍️|⏳|🤝)/.test(line)).map((line) => Array.from(line)[0]);
    expect(marks.join("")).toBe(["🔴", "🔴", "✍", "✍", "✍", "✍", "✍", "⏳", "⏳", "⏳", "⏳", "🤝"].join(""));
    expect(lines[0]).toBe("📌 NEEDS YOU TODAY");
    expect(lines).toContain("+2 more in the panel");
    // 7 waiting on you, oldest first: the 5 oldest stay, so the newest two are the "+2".
    expect(lines.filter((line) => line.startsWith("✍️")).map((line) => line.split(" · ")[2])).toEqual([
      "7 d",
      "6 d",
      "5 d",
      "4 d",
      "3 d",
    ]);
    expect(loopSections(fullInput()).reply.more).toBe(2);
  });

  test("no section, no header", () => {
    expect(renderBrief(loopSections(briefInput()), en, opts)).toEqual([]);
    expect(renderBrief(loopSections(briefInput()), pl, opts)).toEqual([]);
  });

  test("a section holds at most 5 lines and counts the rest from the total the reader gave", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => loop(n, { dueAt: new Date(NOW.getTime() - n * DAY) }));
    const sections = loopSections(briefInput({ waitingLoops: part(rows, 9) }));
    expect(sections.waiting.lines).toHaveLength(BRIEF_SECTION_LINES);
    expect(sections.waiting.more).toBe(4);
    // Oldest due first.
    expect(sections.waiting.lines.map((line) => ("loop" in line ? line.loop.id : ""))).toEqual(
      rows
        .slice(1)
        .reverse()
        .map((row) => row.id)
    );
  });

  test("the panel link goes behind '+n more' when the caller gives one", () => {
    const lines = renderBrief(loopSections(fullInput()), en, {
      ...opts,
      links: { reply: "https://app.test/activity" },
    });
    expect(lines).toContain("+2 more in the panel: https://app.test/activity");
  });
});

describe("the lines (T2, Polish and English)", () => {
  const sections = loopSections(
    briefInput({
      urgent: part([
        mail(1, {
          from: "Jan Kowalski <jan@firma.test>",
          subject: "Pilna zmiana terminu",
          receivedAt: new Date(NOW.getTime() - 2 * HOUR),
        }),
      ]),
      reply: part([
        mail(3, {
          from: "Jan Kowalski <jan@firma.test>",
          subject: "Oferta Q1",
          receivedAt: new Date(NOW.getTime() - 3 * DAY),
        }),
      ]),
      waitingLoops: part([
        loop(1, { text: null, subject: "Oferta Q1", sinceAt: new Date("2026-11-10T09:00:00Z") }),
        loop(2, {
          counterpart: "b@example.test",
          subject: "Umowa",
          dueAt: new Date("2026-11-14T09:00:00Z"),
          autoReplyOnly: true,
        }),
        loop(3, {
          counterpart: "c@example.test",
          subject: "Cennik",
          dueAt: new Date("2026-11-15T09:00:00Z"),
          followUp: "would_draft",
        }),
        loop(4, {
          counterpart: "d@example.test",
          subject: "Plan",
          dueAt: new Date("2026-11-16T09:00:00Z"),
          followUp: "approval",
          autoReplyOnly: true,
        }),
      ]),
      promised: part([
        loop(5, {
          kind: "promised",
          text: "wysłać ofertę",
          counterpart: "anna@example.test",
          dueAt: new Date("2026-11-20T10:00:00Z"),
        }),
      ]),
      stale: part([{ id: "0190a1b2-c3d4-7e5f-8a9b-0000000000aa", subject: "Oferta Q1" }]),
    })
  );

  test("Polish: each kind of line, the date as 'wt. 10.11'", () => {
    expect(renderBrief(sections, pl, opts)).toEqual([
      "📌 DO ZAŁATWIENIA DZIŚ",
      "",
      "🔴 Jan Kowalski <jan@firma.test> · Pilna zmiana terminu · 2 godz.",
      "",
      "✍️ Jan Kowalski <jan@firma.test> · Oferta Q1 · 3 dni",
      "",
      "⏳ anna@example.test nie odpowiada od wt. 10.11 · Oferta Q1",
      "⏳ b@example.test nie odpowiada od wt. 10.11 · Umowa · tylko automatyczna odpowiedź",
      "⏳ c@example.test nie odpowiada od wt. 10.11 · Cennik · przygotowałbym przypomnienie o odpowiedzi",
      "⏳ d@example.test nie odpowiada od wt. 10.11 · Plan · tylko automatyczna odpowiedź · przypomnienie czeka na Twoje zatwierdzenie",
      "",
      "🤝 Obietnica dla anna@example.test: wysłać ofertę · termin pt. 20.11",
      "",
      "⌛ Zamknięte bez odpowiedzi: Oferta Q1",
    ]);
  });

  test("English: each kind of line", () => {
    expect(renderBrief(sections, en, opts)).toEqual([
      "📌 NEEDS YOU TODAY",
      "",
      "🔴 Jan Kowalski <jan@firma.test> · Pilna zmiana terminu · 2 h",
      "",
      "✍️ Jan Kowalski <jan@firma.test> · Oferta Q1 · 3 d",
      "",
      "⏳ No answer from anna@example.test since Tue 10.11 · Oferta Q1",
      "⏳ No answer from b@example.test since Tue 10.11 · Umowa · auto-reply only",
      "⏳ No answer from c@example.test since Tue 10.11 · Cennik · would draft a follow-up",
      "⏳ No answer from d@example.test since Tue 10.11 · Plan · auto-reply only · follow-up waits for your approval",
      "",
      "🤝 You promised anna@example.test: wysłać ofertę · due Fri 20.11",
      "",
      "⌛ Closed without an answer: Oferta Q1",
    ]);
  });

  test("the text of a loop comes before its subject; a loop with no address, no text and no subject still reads", () => {
    const lines = renderBrief(
      loopSections(
        briefInput({
          waitingLoops: part([
            loop(1, { counterpart: null, text: "potwierdzić termin", subject: "Temat" }),
            loop(2, { counterpart: null, text: null, subject: null, dueAt: new Date(NOW.getTime() - DAY) }),
          ]),
          promised: part([loop(3, { kind: "promised", counterpart: null, text: null, subject: null })]),
        })
      ),
      pl,
      opts
    );
    expect(lines).toContain("⏳ Brak odpowiedzi od wt. 10.11 · potwierdzić termin");
    expect(lines).toContain(`⏳ Brak odpowiedzi od wt. 10.11 · ${pl.common.noSubject}`);
    expect(lines).toContain(`🤝 Obietnica: ${pl.common.noSubject} · termin pt. 13.11`);
  });

  test("a delegation line names the delegate and the delegation date, and the delegation sorts with the loops by due", () => {
    const lines = renderBrief(
      loopSections(briefInput({ waitingDelegations: part([delegation(1)]), waitingLoops: part([loop(1)]) })),
      en,
      opts
    );
    expect(lines.filter((line) => line.startsWith("⏳"))).toEqual([
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1",
      "⏳ No answer from Marta since Tue 17.11 · Umowa najmu",
    ]);
  });
});

describe("text that comes from a model or from mail", () => {
  test("a link, an address, a long number and the remains of an escape sequence do not reach the line (review 12, N6)", () => {
    const hostile = "send [31mthe offer[0m to bob@evil.test http://evil.test/x 1234567890123456789012";
    const lines = renderBrief(
      loopSections(briefInput({ promised: part([loop(1, { kind: "promised", text: hostile })]) })),
      en,
      opts
    );
    const line = lines.find((entry) => entry.startsWith("🤝")) ?? "";
    expect(line).not.toContain("evil.test");
    expect(line).not.toContain("[31m");
    expect(line).not.toContain("[0m");
    expect(line).not.toMatch(/\d{12}/);
    expect(line).toContain("send the offer");
  });

  test("a raw escape character, a bidi mark and a line break in a subject or a sender do not reach the message", () => {
    const lines = renderBrief(
      loopSections(
        briefInput({
          reply: part([mail(1, { from: "Eve\u001b[2J <e@x.test>", subject: "Hi‮fdp.exe\nsecond line" })]),
          stale: part([{ id: "0190a1b2-c3d4-7e5f-8a9b-0000000000ab", subject: "Stale\u001b[31m one⁦" }]),
        })
      ),
      en,
      opts
    );
    const text = lines.join("\n");
    // eslint-disable-next-line no-control-regex -- the point is that none of them remain
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
    expect(text).not.toContain("[31m");
  });

  test("withoutEscapeRemains keeps ordinary brackets", () => {
    expect(withoutEscapeRemains("[1] list [a] and [12] item")).toBe("[1] list [a] and [12] item");
    expect(withoutEscapeRemains("a\u001b[0;1Kb[31mc\u001b]0;title\u0007d")).toBe("abcd");
  });
});

describe("the consent of the user (T4)", () => {
  const input = fullInput({
    stale: part([{ id: "0190a1b2-c3d4-7e5f-8a9b-0000000000ac", subject: "Secret reorganisation" }]),
    waitingLoops: part([loop(1, { counterpart: "anna@example.test", subject: "Secret subject", text: "Secret ask" })]),
    promised: part([loop(2, { kind: "promised", counterpart: "promise@example.test", text: "Secret promise" })]),
  });

  test.each([
    [
      "en",
      en,
      [
        "⏳ Waiting on others: 1",
        "🤝 Promised: 1",
        "⌛ Closed without an answer: 1",
        "Confirm the new Telegram terms in the panel to see them here.",
      ],
    ],
    [
      "pl",
      pl,
      [
        "⏳ Czekasz na odpowiedź: 1",
        "🤝 Obietnice: 1",
        "⌛ Zamknięte bez odpowiedzi: 1",
        "Potwierdź nowe zasady Telegrama w panelu, aby zobaczyć je tutaj.",
      ],
    ],
  ] as const)("%s: count lines, no address, no loop subject, no loop text, also for ⌛", (_name, texts, expected) => {
    const lines = renderBrief(loopSections({ ...input, consent: false }), texts, opts);
    const text = lines.join("\n");
    for (const line of expected) expect(lines).toContain(line);
    for (const secret of ["anna@example.test", "promise@example.test", "Secret", "Umowa najmu", "Marta"]) {
      expect(text).not.toContain(secret);
    }
    // The consent ask stands once.
    expect(lines.filter((line) => line === expected[3])).toHaveLength(1);
    // Mail of the inbox shows: 🔴 and ✍️ hold incoming-mail data only.
    expect(lines.some((line) => line.startsWith("🔴"))).toBe(true);
    expect(lines.some((line) => line.startsWith("✍️"))).toBe(true);
  });

  test("a covered user gets no consent ask; an uncovered user with nothing to hide gets none either", () => {
    expect(renderBrief(loopSections(input), en, opts)).not.toContain(
      "Confirm the new Telegram terms in the panel to see them here."
    );
    const lines = renderBrief(loopSections(briefInput({ consent: false, reply: part([mail(1)]) })), en, opts);
    expect(lines.join("\n")).not.toContain("Confirm");
  });

  test("nothing is named for the surfaced or stale marks when the consent hides the lines", () => {
    expect(shownIds(loopSections({ ...input, consent: false }))).toEqual({ surfaced: [], stale: [] });
    expect(shownIds(loopSections(input)).surfaced.length).toBeGreaterThan(0);
    expect(shownIds(loopSections(input)).stale).toEqual(["0190a1b2-c3d4-7e5f-8a9b-0000000000ac"]);
  });
});

describe("shadow (T5)", () => {
  test("a shadow loop says it would draft a follow-up, in both languages", () => {
    const sections = loopSections(
      briefInput({ waitingLoops: part([loop(1, { kind: "delegated", followUp: "would_draft" })]) })
    );
    expect(renderBrief(sections, en, opts)).toContain(
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1 · would draft a follow-up"
    );
    expect(
      renderBrief(sections, pl, opts).some((line) => line.endsWith("· przygotowałbym przypomnienie o odpowiedzi"))
    ).toBe(true);
  });
});

describe("the usual reply time of the contact", () => {
  const linesOf = (usualReplyDays: number | null, extra: Partial<Parameters<typeof loop>[1]> = {}) =>
    loopSections(briefInput({ waitingLoops: part([loop(1, { usualReplyDays, ...extra })]) }));

  test("a loop with a usual reply time ends its line with it, in both languages; two days is plural", () => {
    const sections = linesOf(2);
    expect(renderBrief(sections, en, opts)).toContain(
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1 · usual reply: 2 days"
    );
    expect(renderBrief(sections, pl, opts).some((line) => line.endsWith(" · zwykle odpowiada w 2 dni"))).toBe(true);
  });

  test("one day is singular; five and 22 days are plural in Polish", () => {
    expect(renderBrief(linesOf(1), en, opts).some((line) => line.endsWith(" · usual reply: 1 day"))).toBe(true);
    expect(renderBrief(linesOf(1), pl, opts).some((line) => line.endsWith(" · zwykle odpowiada w 1 dzień"))).toBe(true);
    expect(renderBrief(linesOf(5), pl, opts).some((line) => line.endsWith(" · zwykle odpowiada w 5 dni"))).toBe(true);
  });

  test("null adds no suffix; the suffix comes after a marker", () => {
    for (const texts of [en, pl]) {
      expect(renderBrief(linesOf(null), texts, opts).join("\n")).not.toMatch(/usual reply|zwykle odpowiada/);
    }
    expect(renderBrief(linesOf(3, { autoReplyOnly: true }), en, opts)).toContain(
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1 · auto-reply only · usual reply: 3 days"
    );
  });
});

describe("the 4096 cut (T3)", () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    loop(i + 1, { text: `waiting ${i}`, dueAt: new Date(NOW.getTime() - (10 - i) * DAY) })
  );
  const sectionsInput = briefInput({
    waitingLoops: part(rows),
    promised: part([
      loop(10, { kind: "promised", text: "first promise", dueAt: new Date(NOW.getTime() - 3 * DAY) }),
      loop(11, { kind: "promised", text: "last promise", dueAt: new Date(NOW.getTime() - 1 * DAY) }),
    ]),
  });
  const normal = [1, 2, 3].map((n) => digestItem(n, "needs_reply", { subject: `Normal row ${n}` }));
  // The mailbox lines are never cut: more of them make a base that no normal row can make fit.
  const boxes = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...digestMailbox, id: `m${i}`, address: `box${i}@firma.test` }));
  const render = (count: number, items: typeof normal) =>
    renderDigestWithBrief(
      digestInput({
        items,
        counts: { needs_reply: items.length },
        mailboxes: boxes(count),
        brief: {
          sections: loopSections(sectionsInput),
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    );

  test("normal rows go first, then the last 🤝 line, and '+1' counts the cut line", () => {
    // The first mailbox count at which the message with the whole brief and no row is over the limit.
    let count = 1;
    while (render(count, normal).shown.surfaced.length === 7 && count < 300) count += 1;
    expect(count).toBeLessThan(300);
    // One mailbox line less: the whole brief and no row fit; the rows of the next call must go first.
    const fitting = render(count - 1, normal);
    expect(fitting.message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(fitting.message.text).not.toContain("Normal row");
    expect(fitting.shown.surfaced).toHaveLength(7);

    const cut = render(count, normal);
    expect(cut.message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(cut.message.text).not.toContain("Normal row");
    expect(cut.message.text).toContain("first promise");
    expect(cut.message.text).not.toContain("last promise");
    expect(cut.message.text).toContain("+1 more in the panel");
    expect(cut.shown.surfaced).toHaveLength(6);
    expect(cut.shown.surfaced).not.toContain(loop(11).id);
  });

  test("with room for everything the rows and the lines all stay", () => {
    const whole = render(1, normal);
    expect(whole.message.text).toContain("Normal row 3");
    expect(whole.message.text).toContain("last promise");
    expect(whole.shown.surfaced).toHaveLength(7);
  });

  test("dropLastLine moves the last line of the lowest section into its '+n'", () => {
    const sections = loopSections(sectionsInput);
    const once = dropLastLine(sections);
    expect(once?.promised.lines).toHaveLength(1);
    expect(once?.promised.more).toBe(1);
    const twice = dropLastLine(once ?? sections);
    expect(twice?.promised.lines).toHaveLength(0);
    expect(twice?.promised.more).toBe(2);
    expect(dropLastLine(twice ?? sections)?.waiting.lines).toHaveLength(4);
    expect(dropLastLine(loopSections(briefInput()))).toBeNull();
  });
});

describe("the brief inside the digest", () => {
  const urgent = [1, 2].map((n) => digestItem(n, "urgent", { subject: `Urgent mail ${n}` }));
  const others = [3, 4].map((n) => digestItem(n, "info", { subject: `Info mail ${n}` }));
  const base = (over: Partial<DigestInput> = {}) =>
    digestInput({
      items: [...urgent, ...others],
      counts: { urgent: 2, info: 2 },
      delegations: { open: 1, overdue: 1 },
      ...over,
    });
  const sections = loopSections(fullInput());

  test("the first digest: the block follows the title; the urgent mails leave the normal list; the delegation footer goes", () => {
    const { message } = renderDigestWithBrief(
      base({
        brief: {
          sections,
          loopConsent: true,
          owner: true,
          urgentEmailIds: urgent.map((row) => row.emailId),
          openLoops: null,
        },
      }),
      en
    );
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("📬 Digest 08:00 · Fri 20 Nov");
    expect(lines[2]).toBe("📌 NEEDS YOU TODAY");
    // The 🔴 lines show the urgent mails; the normal list shows only the info mails.
    expect(message.text).toContain("🔴 Jan Kowalski 1");
    expect(message.text).not.toContain("1. ⚠️");
    expect(message.text.match(/^\d+\. /gm)).toHaveLength(2);
    // No "+n more" for the urgent mails that the 🔴 lines took.
    expect(message.text).not.toContain("urgent");
    expect(message.text).not.toContain("Delegations:");
    // The feedback buttons belong to the rows of the normal list only; the loop rows come first, as their lines do.
    expect(message.buttons.slice(-1)[0]?.map((button) => button.text)).toEqual(["✅ 1", "✏️ 1", "✅ 2", "✏️ 2"]);
    expect(message.buttons.flat().filter((button) => /^(✅|✏️) \d$/.test(button.text))).toHaveLength(4);
  });

  test("the delegation footer stays when no ⏳ line names a delegation, and for a member without consent (review 18 N3)", () => {
    const footer = "Delegations: 1 waiting for a reply, 1 overdue";
    const loopsOnly = fullInput({ waitingDelegations: part([]) });
    const only = renderDigestWithBrief(
      base({
        brief: {
          sections: loopSections(loopsOnly),
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    ).message.text;
    expect(only).toContain(footer);
    // A delegation due later is in the footer count only: no ⏳ line for it.
    expect(only).not.toContain("Marta");
    const uncovered = renderDigestWithBrief(
      base({
        brief: {
          sections: loopSections({ ...fullInput(), consent: false }),
          loopConsent: false,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    ).message.text;
    expect(uncovered).toContain(footer);
    // The ⏳ count of a member without consent counts loops only: the delegation is in the footer.
    expect(uncovered).toContain("⏳ Waiting on others: 3");
    expect(uncovered).not.toContain("Marta");
    // A ⏳ line with a delegation: the footer goes.
    const named = renderDigestWithBrief(
      base({ brief: { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null } }),
      en
    ).message.text;
    expect(named).not.toContain(footer);
  });

  test("a later digest keeps the delegation footer and adds the count line", () => {
    const text = renderDigestWithBrief(
      base({
        brief: {
          sections: null,
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: { waiting: 3, promised: 1 },
        },
      }),
      en
    ).message.text;
    expect(text).toContain("Delegations: 1 waiting for a reply, 1 overdue");
    expect(text.split("\n").at(-1)).toBe("🔁 Open loops: 3 waiting, 1 promise due");
    expect(text).not.toContain("NEEDS YOU TODAY");
    expect(
      renderDigestWithBrief(
        base({
          brief: {
            sections: null,
            loopConsent: true,
            owner: true,
            urgentEmailIds: [],
            openLoops: { waiting: 0, promised: 2 },
          },
        }),
        pl
      ).message.text
    ).toContain("🔁 Otwarte sprawy: 2 obietnice z terminem na dziś");
  });

  test("no brief: the digest is the one of today", () => {
    const plain = renderDigestWithBrief(base(), en);
    expect(plain.message.text).toContain("Delegations: 1 waiting for a reply, 1 overdue");
    expect(plain.shown).toEqual({ surfaced: [], stale: [], lineOf: {} });
    // An empty brief adds no header and no blank line.
    const empty = renderDigestWithBrief(
      base({
        brief: {
          sections: loopSections(briefInput()),
          loopConsent: true,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    );
    expect(empty.message.text.replace("Delegations: 1 waiting for a reply, 1 overdue\n", "")).toContain(
      "📬 Digest 08:00"
    );
    expect(empty.message.text).not.toContain("NEEDS YOU TODAY");
  });

  test("the lines of the brief that stayed are named; a covered and an uncovered user differ", () => {
    const covered = renderDigestWithBrief(
      base({ brief: { sections, loopConsent: true, owner: true, urgentEmailIds: [], openLoops: null } }),
      en
    );
    expect(covered.shown.surfaced).toHaveLength(4);
    const uncovered = renderDigestWithBrief(
      base({
        brief: {
          sections: loopSections({ ...fullInput(), consent: false }),
          loopConsent: false,
          owner: true,
          urgentEmailIds: [],
          openLoops: null,
        },
      }),
      en
    );
    expect(uncovered.shown).toEqual({ surfaced: [], stale: [], lineOf: {} });
  });
});
