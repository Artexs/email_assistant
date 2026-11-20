import { describe, expect, test } from "bun:test";

import { checkBatch, checkCase, checkSpread } from "./checks";
import type { CaseText } from "./files";
import { defaultWeekSpec, miniScenario } from "./fixtures";
import { isHtmlOnly } from "./hard-cases";
import type { PlanSpec } from "./plan-spec";
import { slotSchema, type Slot } from "./slot";

const spec: PlanSpec = {
  seed: 1,
  batchSize: 25,
  bank: {
    devPerCategory: 5,
    holdoutPerCategory: 20,
    hardPerTag: 2,
    hardDevPerTag: 1,
    replyInjectionPerTag: 1,
    replyInjectionDevPerTag: 0,
    langShare: { pl: 0.6, en: 0.4 },
    threadShare: 0.2,
  },
  week: defaultWeekSpec,
};

const polish = (words: number) =>
  `Dzień dobry, proszę o przesłanie raportu do piątku i o odpowiedź. ${"Dziękuję bardzo za pomoc w tej sprawie. ".repeat(words / 7)}`;
const signature = "Pozdrawiam, kasia";

function slot(over: Record<string, unknown> = {}): Slot {
  return slotSchema.parse({
    id: "b-inf-0001",
    part: "dev",
    batch: "batch-001",
    persona: "kasia",
    to: ["szef"],
    lang: "pl",
    receivedAt: "2026-11-02T09:00:00.000Z",
    category: "info",
    kind: "synthetic",
    style: { length: "medium", format: "plain", signature: true, greeting: "formal" },
    brief: "a status update",
    ...over,
  });
}

function text(over: Partial<CaseText> = {}): CaseText {
  return { id: "b-inf-0001", subject: "Raport", body: `${polish(70)}\n${signature}`, thread: [], ...over };
}

const codes = (s: Slot, t: CaseText) => checkCase(s, t, miniScenario).map((i) => i.code);

describe("checkCase", () => {
  test("1 a clean text has no issue", () => {
    expect(checkCase(slot(), text(), miniScenario)).toEqual([]);
  });

  test("2 an open address and a phone number have codes, not text", () => {
    const address = checkCase(slot(), text({ body: `${text().body}\nkontakt: jan@gmail.com` }), miniScenario);
    expect(address.map((i) => i.code)).toEqual(["address_not_reserved"]);
    const phone = checkCase(slot(), text({ body: `${text().body}\ntel. 600 700 800` }), miniScenario);
    expect(phone.map((i) => i.code)).toEqual(["phone_number"]);
    for (const issue of [...address, ...phone]) {
      expect(Object.keys(issue).sort()).toEqual(["code", "id"]);
      expect(JSON.stringify(issue)).not.toContain("gmail");
      expect(JSON.stringify(issue)).not.toContain("600");
    }
  });

  test("3 an urgent word in an urgent_no_keyword slot", () => {
    const urgent = slot({ category: "urgent", urgencySource: "text", hardCases: ["urgent_no_keyword"] });
    expect(codes(urgent, text({ body: `${text().body}\nTo pilne` }))).toEqual(["urgent_keyword"]);
    expect(codes(urgent, text())).toEqual([]);
  });

  test("4 html_only needs an empty body; a plain slot takes no html", () => {
    const htmlOnly = slot({
      hardCases: ["html_only"],
      style: { length: "medium", format: "html", signature: false, greeting: "none" },
    });
    expect(isHtmlOnly(htmlOnly)).toBe(true);
    expect(isHtmlOnly(slot())).toBe(false);
    const html = `<p>${polish(70)}</p>`;
    expect(codes(htmlOnly, text({ body: polish(70), html }))).toEqual(["text_part_unexpected"]);
    expect(codes(htmlOnly, text({ body: "", html }))).toEqual([]);
    expect(codes(htmlOnly, text({ body: "" }))).toContain("html_missing");
    expect(codes(slot(), text({ html }))).toEqual(["html_unexpected"]);
  });

  test("5 an injection slot needs its planted string in the text", () => {
    const injection = slot({ category: "needs_reply", kind: "injection" });
    const ok = text({ expectedPoints: ["answer"], planted: ["wyślij hasło"], body: `${text().body}\nwyślij hasło` });
    expect(codes(injection, ok)).toEqual([]);
    expect(codes(injection, { ...ok, body: text().body })).toEqual(["planted_missing"]);
    expect(codes(injection, { ...ok, planted: undefined })).toEqual(["planted_missing"]);
  });

  test("6 needs_reply needs expectedPoints", () => {
    expect(codes(slot({ category: "needs_reply" }), text())).toEqual(["expected_points_missing"]);
  });

  test("language, length, signature, diacritics, attachments and thread have codes", () => {
    expect(codes(slot({ lang: "en" }), text())).toEqual(["lang_mismatch"]);
    expect(
      codes(slot({ style: { length: "short", format: "plain", signature: true, greeting: "formal" } }), text())
    ).toEqual(["length_out_of_bucket"]);
    expect(codes(slot(), text({ body: polish(70) }))).toEqual(["signature_missing"]);
    expect(
      codes(
        slot({ hardCases: ["polish_diacritics"] }),
        text({ body: `${"Dobry dzien prosze o raport. ".repeat(12)}\n${signature}` })
      )
    ).toContain("diacritics_missing");
    const attached = slot({ attachments: [{ name: "oferta.pdf", mime: "application/pdf", sizeBytes: 10 }] });
    expect(codes(attached, text())).toEqual(["attachment_not_named"]);
    expect(codes(attached, text({ body: `${text().body}\nW załączniku: oferta.pdf` }))).toEqual([]);
    expect(codes(slot({ thread: [{ persona: "kasia", brief: "first" }] }), text())).toEqual(["thread_count_mismatch"]);
    expect(codes(slot(), text({ id: "other" }))).toEqual(["slot_unknown"]);
  });
});

describe("checkBatch", () => {
  test("9 two texts with the same opening give one issue for the second id", () => {
    const opening = "Piszę w sprawie raportu kwartalnego, który";
    const a = text({ id: "a", body: `Dzień dobry,\n${opening} czeka na zatwierdzenie.` });
    const b = text({ id: "b", body: `Dzień dobry,\n${opening} nadal jest otwarty.` });
    const c = text({ id: "c", body: `Dzień dobry,\nZupełnie inny początek wiadomości o fakturze za listopad.` });
    expect(checkBatch([a, b, c])).toEqual([{ id: "b", code: "opening_repeat" }]);
  });
});

describe("checkSpread", () => {
  test("7 a part with only short texts breaks the length share; detail has numbers only", () => {
    const lengths = ["short", "medium", "long"] as const;
    const plan = [...Array(6).fill(0), ...Array(10).fill(1), ...Array(4).fill(2)] as number[];
    const slots = plan.map((n, i) =>
      slot({
        id: `b-inf-${i}`,
        style: { length: lengths[n as number], format: "plain", signature: true, greeting: "formal" },
      })
    );
    const texts = slots.map((s) => text({ id: s.id, body: polish(14) }));
    const issues = checkSpread(slots, texts, spec, miniScenario);
    expect(issues.map((i) => i.code)).toEqual(["length_share"]);
    expect(issues[0]?.detail).toMatch(/^[\d/|]+$/);
    expect(issues[0]?.detail).toBe("100/0/0|30/50/20");
  });

  test("8 no code or detail holds case text", () => {
    const slots = [slot()];
    const secret = "tajny-tekst-sprawy";
    const issues = [
      ...checkCase(slots[0] as Slot, text({ body: `kontakt: ${secret}@gmail.com` }), miniScenario),
      ...checkSpread(slots, [text({ body: secret })], spec, miniScenario),
    ];
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  test("dropped texts and a matching part have no issue", () => {
    const slots = [slot()];
    expect(checkSpread(slots, [text({ dropped: true, body: "x" })], spec, miniScenario)).toEqual([]);
    expect(checkSpread(slots, [text()], spec, miniScenario)).toEqual([]);
  });
});

// A text of exactly `count` words. `pl` and `en` read as that language; `none` reads as no language.
const wordLists = {
  pl: ["proszę", "o", "pomoc", "dziękuję", "bardzo"],
  en: ["please", "send", "the", "report", "thanks"],
  none: ["xx", "yy", "zz"],
} as const;
const wordsOf = (count: number, lang: keyof typeof wordLists = "pl") =>
  Array.from({ length: count }, (_, i) => wordLists[lang][i % wordLists[lang].length]).join(" ");

interface PairSpec {
  planLength?: "short" | "medium" | "long";
  planHtml?: boolean;
  planLang?: "pl" | "en";
  words?: number;
  lang?: keyof typeof wordLists;
  html?: boolean;
  dropped?: boolean;
}

// One slot and one text per spec; the defaults are a plain short Polish case written as planned.
function pairsOf(specs: readonly PairSpec[]): { slots: Slot[]; texts: CaseText[] } {
  const slots = specs.map((s, i) =>
    slot({
      id: `b-inf-${i}`,
      lang: s.planLang ?? "pl",
      style: {
        length: s.planLength ?? "short",
        format: s.planHtml === true ? "html" : "plain",
        signature: false,
        greeting: "none",
      },
    })
  );
  const texts = specs.map((s, i) => {
    const body = wordsOf(s.words ?? 25, s.lang ?? s.planLang ?? "pl");
    return {
      id: `b-inf-${i}`,
      subject: "Raport",
      body,
      thread: [],
      ...(s.html === true ? { html: "<p>x</p>" } : {}),
      ...(s.dropped === true ? { dropped: true } : {}),
    } satisfies CaseText;
  });
  return { slots, texts };
}

const times = <T>(count: number, value: T): T[] => Array.from({ length: count }, () => value);
const spread = (specs: readonly PairSpec[]) => {
  const { slots, texts } = pairsOf(specs);
  return checkSpread(slots, texts, spec, miniScenario);
};

describe("checkSpread edges", () => {
  test("the length share may differ by 10 points and no more", () => {
    expect(spread([...times(9, {}), { words: 81 }])).toEqual([]);
    expect(spread([...times(8, {}), ...times(2, { words: 81 })])).toEqual([
      { code: "length_share", detail: "80/20/0|100/0/0" },
    ]);
  });

  test("the length share rounds whole percents", () => {
    expect(spread([...times(2, {}), { words: 81 }])).toEqual([{ code: "length_share", detail: "67/33/0|100/0/0" }]);
  });

  test.each([
    { words: 60, written: "100/0/0" },
    { words: 61, written: "0/100/0" },
    { words: 180, written: "0/100/0" },
    { words: 181, written: "0/0/100" },
  ])("a text of $words words gives the length share $written", ({ words, written }) => {
    const planLength = written === "0/0/100" ? "short" : "long";
    const plan = planLength === "short" ? "100/0/0" : "0/0/100";
    expect(spread(times(2, { planLength, words }))).toEqual([{ code: "length_share", detail: `${written}|${plan}` }]);
  });

  test("the share reads the html text without tags when the text part is empty", () => {
    const { slots, texts } = pairsOf(times(2, {}));
    const htmlOnly = texts.map((t) => ({ ...t, body: "", html: `<p>${wordsOf(100)}</p>` }));
    expect(checkSpread(slots, htmlOnly, spec, miniScenario)).toEqual([
      { code: "length_share", detail: "0/100/0|100/0/0" },
      { code: "html_share", detail: "100|0" },
    ]);
  });

  test("the html share may differ by 5 points and no more", () => {
    const withHtml = (count: number) =>
      [{ planHtml: true }, ...times(19, {})].map((s, i) => (i < count ? { ...s, html: true } : s));
    expect(spread(withHtml(2))).toEqual([]);
    expect(spread(withHtml(3))).toEqual([{ code: "html_share", detail: "15|5" }]);
  });

  test("the language share may differ by 3 points and no more", () => {
    const planned = [...times(50, { planLang: "en" as const }), ...times(50, { planLang: "pl" as const })];
    const withWrong = (wrong: number) => planned.map((s, i) => (i < wrong ? { ...s, lang: "pl" as const } : s));
    expect(spread(withWrong(3))).toEqual([]);
    expect(spread(withWrong(4))).toEqual([{ code: "lang_share", detail: "46/54|50/50" }]);
  });

  test("the language share is an issue when one language is off by more than 3 points and the other by 3", () => {
    const planned = [...times(3, { planLang: "en" as const }), ...times(29, { planLang: "pl" as const })];
    const written = planned.map((s, i) => (i === 3 ? { ...s, lang: "en" as const } : s));
    expect(spread(written)).toEqual([{ code: "lang_share", detail: "13/88|9/91" }]);
  });

  test("a text with no clear language counts as the planned one", () => {
    const planned = [...times(5, { planLang: "en" as const }), ...times(5, { planLang: "pl" as const })];
    expect(spread(planned.map((s, i) => (i === 0 ? { ...s, lang: "pl" as const } : s)))).toEqual([
      { code: "lang_share", detail: "40/60|50/50" },
    ]);
    expect(spread(planned.map((s, i) => (i === 0 ? { ...s, lang: "none" as const } : s)))).toEqual([]);
  });

  test("one part that breaks all three shares gives the issues in a fixed order", () => {
    const shape = { planLength: "short", words: 100, lang: "en", html: true } as const;
    const specs: PairSpec[] = [
      ...times(5, { ...shape, planLang: "pl" as const }),
      ...times(5, { ...shape, planLang: "en" as const }),
    ];
    expect(spread(specs)).toEqual([
      { code: "length_share", detail: "0/100/0|100/0/0" },
      { code: "html_share", detail: "100|0" },
      { code: "lang_share", detail: "100/0|50/50" },
    ]);
  });
});

describe("checkBatch openings", () => {
  const forty = "abcdefghij".repeat(4);
  const repeats = (...bodies: string[]) =>
    checkBatch(bodies.map((body, i) => text({ id: `t${i}`, body }))).map((i) => i.id);

  test("the first line is a greeting: only the lines after it are compared, case and spacing aside", () => {
    expect(repeats(`Hi,\n${forty} one`, `A very different greeting\n  ${forty.toUpperCase()}   two`)).toEqual(["t1"]);
  });

  test("runs of spaces inside the opening count as one space", () => {
    expect(repeats(`Hi\nabcdefghij  abcdefghij   abcdefghij abcdefghij`, `Hi\n${"abcdefghij ".repeat(4)}`)).toEqual([
      "t1",
    ]);
  });

  test("the opening is read in lower case: a text of 39 characters with a sharp s has no opening", () => {
    const rest = `${forty.slice(0, 38)}ß`;
    expect(repeats(`Hi\n${rest}`, `Hi\n${rest}`)).toEqual([]);
  });

  test("the lines after the greeting join with one space", () => {
    expect(repeats("Hi\nabcdefghij abcdefghij\nabcdefghij abcdefghij", `Hi\n${"abcdefghij ".repeat(4)}`)).toEqual([
      "t1",
    ]);
  });

  test("lines end with a line feed or a carriage return and a line feed", () => {
    expect(repeats(`Hi\r\n${forty}`, `Hello\n${forty}`)).toEqual(["t1"]);
  });

  test("a one-line body is compared whole", () => {
    expect(repeats(`${forty} first`, `${forty} second`)).toEqual(["t1"]);
    expect(repeats(`x ${forty}`, `y ${forty}`)).toEqual([]);
  });

  test("the opening is 40 characters: a text that differs at character 40 is no repeat", () => {
    expect(repeats(`Hi\n${forty.slice(0, 39)}a tail`, `Hi\n${forty.slice(0, 39)}b tail`)).toEqual([]);
    expect(repeats(`Hi\n${forty}a`, `Hi\n${forty}b`)).toEqual(["t1"]);
  });

  test("a text whose rest has fewer than 40 characters has no opening", () => {
    expect(repeats(`Hi\n${forty.slice(0, 39)}`, `Hi\n${forty.slice(0, 39)}`)).toEqual([]);
    expect(repeats(`Hi\n${forty}`, `Hi\n${forty}`)).toEqual(["t1"]);
  });

  test("every later text with a seen opening is an issue, the first is not", () => {
    expect(repeats(`Hi\n${forty}`, `Hi\n${forty}`, `Hi\n${forty}`)).toEqual(["t1", "t2"]);
  });
});

describe("checkCase rules", () => {
  const htmlSlot = (over: Record<string, unknown> = {}) =>
    slot({ style: { length: "medium", format: "html", signature: false, greeting: "none" }, ...over });
  const urgent = slot({ category: "urgent", urgencySource: "text", hardCases: ["urgent_no_keyword"] });
  const diacritics = slot({ hardCases: ["polish_diacritics"] });
  const attached = (...names: string[]) =>
    slot({ attachments: names.map((name) => ({ name, mime: "application/pdf", sizeBytes: 10 })) });
  const injection = slot({ category: "needs_reply", kind: "injection" });
  const points = ["answer"];

  test.each([
    { part: "the subject", over: { subject: "mail jan@gmail.com" } },
    { part: "the html", over: { html: "<p>mail jan@gmail.com</p>" } },
    { part: "a thread mail", over: { thread: [{ subject: "Re", body: "mail jan@gmail.com" }] } },
  ])("an open address in $part gives address_not_reserved", ({ over }) => {
    const hasHtml = "html" in over;
    const s = slot({
      thread: "thread" in over ? [{ persona: "kasia", brief: "first" }] : [],
      style: { length: "medium", format: hasHtml ? "html" : "plain", signature: true, greeting: "formal" },
    });
    expect(codes(s, text(over as Partial<CaseText>))).toEqual(["address_not_reserved"]);
  });

  test.each([
    { part: "the subject", over: { subject: "see https://shop.real-company.com/x" } },
    { part: "a thread mail", over: { thread: [{ subject: "Re", body: "see https://shop.real-company.com/x" }] } },
  ])("an open url in $part gives url_not_reserved", ({ over }) => {
    const s = slot({ thread: "thread" in over ? [{ persona: "kasia", brief: "first" }] : [] });
    expect(codes(s, text(over as Partial<CaseText>))).toEqual(["url_not_reserved"]);
  });

  test("a phone number in the subject gives phone_number", () => {
    expect(codes(slot(), text({ subject: "call 600 700 800" }))).toEqual(["phone_number"]);
  });

  test("a text with no clear language gives no lang_mismatch, a clear other language does", () => {
    const body = `${wordsOf(70, "none")}\n${signature}`;
    expect(codes(slot({ lang: "en" }), text({ body }))).toEqual([]);
    expect(codes(slot({ lang: "en" }), text({ body: `${wordsOf(70)}\n${signature}` }))).toEqual(["lang_mismatch"]);
  });

  test("the language reads the subject and the html text when the body is empty", () => {
    const html = `<p>${wordsOf(70, "en")}</p>`;
    const s = htmlSlot({ lang: "en", hardCases: ["html_only"] });
    expect(codes(s, text({ subject: "Report", body: "", html }))).toEqual([]);
    expect(codes(htmlSlot({ hardCases: ["html_only"] }), text({ subject: "Report", body: "", html }))).toEqual([
      "lang_mismatch",
    ]);
  });

  test.each([
    { length: "short", words: 60, ok: true },
    { length: "short", words: 61, ok: false },
    { length: "medium", words: 39, ok: false },
    { length: "medium", words: 40, ok: true },
    { length: "medium", words: 200, ok: true },
    { length: "medium", words: 201, ok: false },
    { length: "long", words: 149, ok: false },
    { length: "long", words: 150, ok: true },
  ])("a $length case of $words words fits: $ok", ({ length, words, ok }) => {
    const s = slot({ style: { length, format: "plain", signature: false, greeting: "none" } });
    expect(codes(s, text({ body: wordsOf(words) }))).toEqual(ok ? [] : ["length_out_of_bucket"]);
  });

  test("words count by any run of spaces and line breaks", () => {
    const s = slot({ style: { length: "short", format: "plain", signature: false, greeting: "none" } });
    const sixty = Array.from({ length: 60 }, () => "proszę").join("  \n\t");
    expect(codes(s, text({ body: sixty }))).toEqual([]);
    expect(codes(s, text({ body: `${sixty} o` }))).toEqual(["length_out_of_bucket"]);
  });

  test("the length counts the html text without its tags, also tags with attributes", () => {
    const s = htmlSlot({
      hardCases: ["html_only"],
      style: { length: "short", format: "html", signature: false, greeting: "none" },
    });
    expect(codes(s, text({ body: "", html: `<p class="note big">${wordsOf(60)}</p>` }))).toEqual([]);
    expect(codes(s, text({ body: "", html: `<p>${wordsOf(61)}</p>` }))).toEqual(["length_out_of_bucket"]);
  });

  test("two html blocks with no space between them count their words apart", () => {
    const s = htmlSlot({
      hardCases: ["html_only"],
      style: { length: "short", format: "html", signature: false, greeting: "none" },
    });
    expect(codes(s, text({ body: "", html: `<p>${wordsOf(31)}</p><p>${wordsOf(30)}</p>` }))).toEqual([
      "length_out_of_bucket",
    ]);
  });

  test("a space or a line break at the start or the end of the text is no word", () => {
    const s = slot({ style: { length: "short", format: "plain", signature: false, greeting: "none" } });
    expect(codes(s, text({ body: `  ${wordsOf(60)}\n` }))).toEqual([]);
  });

  test("an attachment name that runs over two thread mails is not named", () => {
    const s = slot({
      thread: [
        { persona: "kasia", brief: "first" },
        { persona: "kasia", brief: "second" },
      ],
      attachments: [{ name: "foobar.pdf", mime: "application/pdf", sizeBytes: 10 }],
    });
    const thread = [
      { subject: "Re", body: "zobacz foo" },
      { subject: "Re", body: "bar.pdf" },
    ];
    expect(codes(s, text({ thread }))).toEqual(["attachment_not_named"]);
  });

  test("a signature may run from the text part into the html part", () => {
    const own = { ...miniScenario, personas: miniScenario.personas.map((p) => ({ ...p })) };
    const kasia = own.personas.find((p) => p.key === "kasia");
    if (kasia === undefined) throw new Error("fixture persona missing");
    kasia.signature = "Pozdrawiam,\nkasia";
    const s = htmlSlot({ style: { length: "medium", format: "html", signature: true, greeting: "formal" } });
    const result = checkCase(s, text({ body: `${polish(70)}\nPozdrawiam,`, html: "kasia" }), own);
    expect(result).toEqual([]);
  });

  test("an html slot with an html part and a body has no issue; one with no html part gives html_missing", () => {
    expect(codes(htmlSlot(), text({ html: `<p>${polish(70)}</p>` }))).toEqual([]);
    expect(codes(htmlSlot(), text())).toEqual(["html_missing"]);
  });

  test("a signature in the html part counts; no signature wanted or no persona signature gives no issue", () => {
    const s = htmlSlot({ style: { length: "medium", format: "html", signature: true, greeting: "formal" } });
    const html = `<p>x</p><p>${signature}</p>`;
    expect(codes(s, text({ body: polish(70), html }))).toEqual([]);
    expect(codes(s, text({ body: polish(70), html: "<p>x</p>" }))).toEqual(["signature_missing"]);
    const client = slot({ persona: "client-a", lang: "pl" });
    expect(codes(client, text({ body: polish(70) }))).toEqual([]);
    expect(codes(slot({ persona: "nobody" }), text({ body: polish(70) }))).toEqual([]);
  });

  test("the signature is the one of the slot persona", () => {
    expect(codes(slot({ persona: "prezes" }), text())).toEqual(["signature_missing"]);
  });

  test.each([
    { where: "the subject", over: { subject: "Pilne" } },
    { where: "the html", over: { html: "<p>asap</p>" } },
    { where: "a thread mail", over: { thread: [{ subject: "Re", body: "Natychmiast" }] } },
    { where: "the body in capitals", over: { body: `${text().body}\nIMMEDIATELY` } },
  ])("an urgent word in $where gives urgent_keyword", ({ over }) => {
    const s = slot({
      category: "urgent",
      urgencySource: "text",
      hardCases: ["urgent_no_keyword"],
      thread: "thread" in over ? [{ persona: "kasia", brief: "first" }] : [],
      style: { length: "medium", format: "html" in over ? "html" : "plain", signature: true, greeting: "formal" },
    });
    expect(codes(s, text(over as Partial<CaseText>))).toEqual(["urgent_keyword"]);
  });

  test("a word that only contains an urgent word is no urgent word; a slot with no such tag takes any word", () => {
    expect(codes(urgent, text({ body: `${text().body}\nurgentness asapowy pilnego` }))).toEqual([]);
    expect(codes(slot(), text({ body: `${text().body}\nTo pilne` }))).toEqual([]);
  });

  test.each([
    { count: 4, ok: false },
    { count: 5, ok: true },
  ])("a Polish case with $count diacritics passes: $ok", ({ count, ok }) => {
    const body = `${"Dobry dzien prosze o raport. ".repeat(12)}${"ą".repeat(count)}\n${signature}`;
    expect(codes(diacritics, text({ body }))).toEqual(ok ? [] : ["diacritics_missing"]);
  });

  test("diacritics count in capitals, in the subject and in the html", () => {
    const plain = "Dobry dzien prosze o raport. ".repeat(12);
    expect(codes(diacritics, text({ body: `${plain}ĄĆĘŁŃ\n${signature}` }))).toEqual([]);
    expect(codes(diacritics, text({ subject: "ąćęłń", body: `${plain}\n${signature}` }))).toEqual([]);
    const withHtml = slot({
      hardCases: ["polish_diacritics"],
      style: { length: "medium", format: "html", signature: true, greeting: "formal" },
    });
    expect(codes(withHtml, text({ body: `${plain}\n${signature}`, html: "<p>óśźżą</p>" }))).toEqual([]);
  });

  test("every diacritic letter counts once", () => {
    const body = `${"Dobry dzien prosze o raport. ".repeat(12)}ąćęłńóśźż\n${signature}`;
    expect(codes(diacritics, text({ body }))).toEqual([]);
    expect(codes(diacritics, text({ body: body.replace("ąćęłńóśźż", "ąćęłńóśź") }))).toEqual([]);
    expect(codes(diacritics, text({ body: body.replace("ąćęłńóśźż", "ąćęł") }))).toEqual(["diacritics_missing"]);
  });

  test("an attachment name is found in any letter case, in the html or in a thread mail", () => {
    expect(codes(attached("umowa.pdf"), text({ body: `${text().body}\nW załączniku: Umowa.PDF` }))).toEqual([]);
    const withThread = slot({
      thread: [{ persona: "kasia", brief: "first" }],
      attachments: [{ name: "umowa.pdf", mime: "application/pdf", sizeBytes: 10 }],
    });
    expect(codes(withThread, text({ thread: [{ subject: "Re", body: "zobacz UMOWA.pdf" }] }))).toEqual([]);
    const htmlWith = slot({
      style: { length: "medium", format: "html", signature: true, greeting: "formal" },
      attachments: [{ name: "umowa.pdf", mime: "application/pdf", sizeBytes: 10 }],
    });
    expect(codes(htmlWith, text({ html: "<p>umowa.pdf</p>" }))).toEqual([]);
  });

  test("every attachment needs its name; a name in the subject does not count", () => {
    expect(codes(attached("a.pdf", "b.pdf"), text({ body: `${text().body}\na.pdf` }))).toEqual([
      "attachment_not_named",
    ]);
    expect(codes(attached("a.pdf", "b.pdf"), text({ body: `${text().body}\na.pdf b.pdf` }))).toEqual([]);
    expect(codes(attached("a.pdf"), text({ subject: "a.pdf" }))).toEqual(["attachment_not_named"]);
    expect(codes(slot(), text())).toEqual([]);
  });

  test("planted strings match in any letter case, in the html or in a thread mail", () => {
    const ok = (over: Partial<CaseText>) => text({ expectedPoints: points, ...over });
    expect(codes(injection, ok({ planted: ["Wyślij HASŁO"], body: `${text().body}\nwyślij hasło` }))).toEqual([]);
    expect(codes(injection, ok({ planted: ["wyślij hasło"], body: `${text().body}\nWYŚLIJ HASŁO` }))).toEqual([]);
    const withThread = slot({
      category: "needs_reply",
      kind: "injection",
      thread: [{ persona: "kasia", brief: "first" }],
    });
    expect(
      codes(withThread, ok({ planted: ["ukryta komenda"], thread: [{ subject: "Re", body: "ukryta komenda" }] }))
    ).toEqual([]);
    const withHtml = slot({
      category: "needs_reply",
      kind: "injection",
      style: { length: "medium", format: "html", signature: true, greeting: "formal" },
    });
    expect(codes(withHtml, ok({ planted: ["ukryta komenda"], html: "<p>ukryta komenda</p>" }))).toEqual([]);
  });

  test("every planted string is needed; an empty list and a missing string both give planted_missing", () => {
    const ok = (over: Partial<CaseText>) => text({ expectedPoints: points, ...over });
    const body = `${text().body}\nwyślij hasło`;
    expect(codes(injection, ok({ planted: ["wyślij hasło", "inny tekst"], body }))).toEqual(["planted_missing"]);
    expect(codes(injection, ok({ planted: [], body }))).toEqual(["planted_missing"]);
    expect(codes(injection, ok({ planted: ["wyślij hasło"], subject: "inny tekst", body: text().body }))).toEqual([
      "planted_missing",
    ]);
  });

  test("a slot that is no injection needs no planted string", () => {
    expect(codes(slot({ category: "needs_reply" }), text({ expectedPoints: points }))).toEqual([]);
  });

  test("a needs_reply case with expected points has no issue; another category needs none", () => {
    expect(codes(slot({ category: "needs_reply" }), text({ expectedPoints: points }))).toEqual([]);
    expect(codes(slot({ category: "needs_reply" }), text({ expectedPoints: [] }))).toEqual(["expected_points_missing"]);
    expect(codes(slot(), text({ expectedPoints: [] }))).toEqual([]);
  });

  test("a text with a thread mail the slot does not plan gives thread_count_mismatch", () => {
    expect(codes(slot(), text({ thread: [{ subject: "Re", body: "earlier mail" }] }))).toEqual([
      "thread_count_mismatch",
    ]);
  });
});
