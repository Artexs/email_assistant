import { describe, expect, test } from "bun:test";

import { briefTexts } from "./brief";

// The brief lines of the first digest. English and Polish have the same entries (the type enforces it); these tests
// pin the Polish forms: the plural of a count, the words that need a diacritic, and no machine-made ASCII spelling.
const en = briefTexts.en;
const pl = briefTexts.pl;

describe("the count line of a later digest", () => {
  test.each([
    [1, 0, "🔁 Otwarte sprawy: 1 oczekująca"],
    [2, 0, "🔁 Otwarte sprawy: 2 oczekujące"],
    [5, 0, "🔁 Otwarte sprawy: 5 oczekujących"],
    [12, 0, "🔁 Otwarte sprawy: 12 oczekujących"],
    [22, 0, "🔁 Otwarte sprawy: 22 oczekujące"],
    [0, 1, "🔁 Otwarte sprawy: 1 obietnica z terminem na dziś"],
    [0, 3, "🔁 Otwarte sprawy: 3 obietnice z terminem na dziś"],
    [0, 5, "🔁 Otwarte sprawy: 5 obietnic z terminem na dziś"],
    [3, 1, "🔁 Otwarte sprawy: 3 oczekujące, 1 obietnica z terminem na dziś"],
  ] as const)("pl %i waiting, %i promised", (waiting, promised, line) => {
    expect(pl.openLoops(waiting, promised)).toBe(line);
  });

  test("en: the singular and the plural of a promise", () => {
    expect(en.openLoops(3, 1)).toBe("🔁 Open loops: 3 waiting, 1 promise due");
    expect(en.openLoops(0, 2)).toBe("🔁 Open loops: 2 promises due");
  });
});

describe("the fixed lines", () => {
  test("Polish keeps its diacritics and the words of the other panels", () => {
    expect(pl.title).toBe("📌 DO ZAŁATWIENIA DZIŚ");
    expect(pl.consentAsk).toBe("Potwierdź nowe zasady Telegrama w panelu, aby zobaczyć je tutaj.");
    expect(pl.waitingMarker.wouldDraft).toBe("przygotowałbym przypomnienie o odpowiedzi");
    expect(pl.waitingMarker.approval).toBe("przypomnienie czeka na Twoje zatwierdzenie");
    expect(pl.waitingMarker.autoReply).toBe("tylko automatyczna odpowiedź");
    expect(pl.staleLine("Oferta")).toBe("⌛ Zamknięte bez odpowiedzi: Oferta");
    expect(pl.waitingCount(3)).toBe("⏳ Czekasz na odpowiedź: 3");
    expect(pl.promisedCount(2)).toBe("🤝 Obietnice: 2");
    expect(pl.more(2, null)).toBe("+2 więcej w panelu");
    expect(pl.more(2, "https://p.test/a")).toBe("+2 więcej w panelu: https://p.test/a");
  });

  test("every Polish line holds a diacritic or a plain word, never a word with its diacritic dropped", () => {
    // A few words that must not appear in the ASCII spelling.
    const all = [
      pl.title,
      pl.consentAsk,
      pl.waitingLine("a@x.test", "wt. 10.11", "Oferta"),
      pl.promisedLine("a@x.test", "wysłać ofertę", "pt. 20.11"),
      pl.staleLine("x"),
      pl.waitingCount(1),
      pl.promisedCount(1),
      pl.staleCount(1),
      ...Object.values(pl.waitingMarker),
    ].join("\n");
    for (const ascii of ["ZALATWIENIA", "DZIS", "wiecej", "zobaczyc", "Zamkniete", "odpowiedz:"]) {
      expect(all).not.toContain(ascii);
    }
  });

  test("age words", () => {
    expect([en.ageUnderHour, en.ageHours(3), en.ageDays(2)]).toEqual(["<1 h", "3 h", "2 d"]);
    expect([pl.ageUnderHour, pl.ageHours(3), pl.ageDays(2)]).toEqual(["<1 godz.", "3 godz.", "2 dni"]);
    expect([1, 5, 22].map((days) => pl.ageDays(days))).toEqual(["1 dzień", "5 dni", "22 dni"]);
  });
});
