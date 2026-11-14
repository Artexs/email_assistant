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
