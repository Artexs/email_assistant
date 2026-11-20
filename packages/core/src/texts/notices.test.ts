import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

describe("weekly notice lines with a count", () => {
  test.each([
    { locale: "en", pending: 0, text: "Open loops on time: no delegation was due" },
    { locale: "en", pending: 1, text: "Open loops on time: no delegation was due, 1 still open" },
    { locale: "en", pending: 3, text: "Open loops on time: no delegation was due, 3 still open" },
    { locale: "pl", pending: 0, text: "Zlecenia w terminie: żadne nie miało terminu" },
    { locale: "pl", pending: 1, text: "Zlecenia w terminie: żadne nie miało terminu, 1 nadal otwarte" },
    { locale: "pl", pending: 3, text: "Zlecenia w terminie: żadne nie miało terminu, 3 nadal otwarte" },
    { locale: "pl", pending: 5, text: "Zlecenia w terminie: żadne nie miało terminu, 5 nadal otwartych" },
  ] as const)("loopsNone in $locale with $pending still open", ({ locale, pending, text }) => {
    expect(textTables[locale].notices.weekly.loopsNone(pending)).toBe(text);
  });

  test.each([
    { locale: "en", pending: 0, text: "Open loops on time: 3 of 4, 2 of 5" },
    { locale: "en", pending: 1, text: "Open loops on time: 3 of 4, 2 of 5, 1 still open" },
    { locale: "en", pending: 3, text: "Open loops on time: 3 of 4, 2 of 5, 3 still open" },
    { locale: "pl", pending: 0, text: "Zlecenia w terminie: 3 of 4, 2 of 5" },
    { locale: "pl", pending: 1, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 1 nadal otwarte" },
    { locale: "pl", pending: 3, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 3 nadal otwarte" },
    { locale: "pl", pending: 5, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 5 nadal otwartych" },
  ] as const)("loops in $locale with $pending still open", ({ locale, pending, text }) => {
    expect(textTables[locale].notices.weekly.loops("3 of 4", "2 of 5", pending)).toBe(text);
  });

  test.each([
    { locale: "en", p90: null, noticed: 0, without: 0, text: "Urgent notice time: p90 – (0 notices)" },
    { locale: "en", p90: 12, noticed: 1, without: 0, text: "Urgent notice time: p90 12 min (1 notice)" },
    {
      locale: "en",
      p90: 12.5,
      noticed: 2,
      without: 1,
      text: "Urgent notice time: p90 12.5 min (2 notices, 1 without a notice)",
    },
    {
      locale: "pl",
      p90: null,
      noticed: 0,
      without: 0,
      text: "Czas powiadomienia o pilnej poczcie: p90 – (0 powiadomień)",
    },
    {
      locale: "pl",
      p90: 12,
      noticed: 1,
      without: 0,
      text: "Czas powiadomienia o pilnej poczcie: p90 12 min (1 powiadomienie)",
    },
    {
      locale: "pl",
      p90: 12.5,
      noticed: 2,
      without: 1,
      text: "Czas powiadomienia o pilnej poczcie: p90 12,5 min (2 powiadomienia, 1 bez powiadomienia)",
    },
    {
      locale: "pl",
      p90: 12,
      noticed: 5,
      without: 0,
      text: "Czas powiadomienia o pilnej poczcie: p90 12 min (5 powiadomień)",
    },
  ] as const)("urgent in $locale with p90 $p90, $noticed noticed, $without without", (row) => {
    expect(textTables[row.locale].notices.weekly.urgent(row.p90, row.noticed, row.without)).toBe(row.text);
  });

  test.each([
    { locale: "en", unpriced: 0, text: "Cost: $1.5 per mailbox per month (target ≤ $3)" },
    { locale: "en", unpriced: 1, text: "Cost: $1.5 per mailbox per month (target ≤ $3), 1 call without a price" },
    { locale: "en", unpriced: 2, text: "Cost: $1.5 per mailbox per month (target ≤ $3), 2 calls without a price" },
    { locale: "pl", unpriced: 0, text: "Koszt: $1,5 miesięcznie na skrzynkę (cel ≤ $3)" },
    { locale: "pl", unpriced: 1, text: "Koszt: $1,5 miesięcznie na skrzynkę (cel ≤ $3), 1 wywołanie bez ceny" },
    { locale: "pl", unpriced: 2, text: "Koszt: $1,5 miesięcznie na skrzynkę (cel ≤ $3), 2 wywołania bez ceny" },
    { locale: "pl", unpriced: 5, text: "Koszt: $1,5 miesięcznie na skrzynkę (cel ≤ $3), 5 wywołań bez ceny" },
  ] as const)("cost in $locale with $unpriced unpriced calls", ({ locale, unpriced, text }) => {
    expect(textTables[locale].notices.weekly.cost("1.5", 3, unpriced)).toBe(text);
  });
});

describe("action failed notice", () => {
  test.each([
    { locale: "en", folder: null, text: "The mail stays in its AI folder: move it by hand." },
    { locale: "en", folder: "AI/Info", text: "The mail stays in AI/Info: move it by hand." },
    { locale: "pl", folder: null, text: "Wiadomość zostaje w swoim folderze AI. Przenieś ją ręcznie." },
    { locale: "pl", folder: "AI/Info", text: "Wiadomość zostaje w folderze: AI/Info. Przenieś ją ręcznie." },
  ] as const)("staysInAiFolder in $locale for folder $folder", ({ locale, folder, text }) => {
    expect(textTables[locale].notices.actionFailed.staysInAiFolder(folder)).toBe(text);
  });
});
