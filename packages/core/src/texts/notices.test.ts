import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

describe("weekly notice lines with a count", () => {
  test.each([
    {
      name: "en one still open",
      locale: "en",
      pending: 1,
      text: "Open loops on time: no delegation was due, 1 still open",
    },
    {
      name: "en three still open",
      locale: "en",
      pending: 3,
      text: "Open loops on time: no delegation was due, 3 still open",
    },
    { name: "pl none still open", locale: "pl", pending: 0, text: "Zlecenia w terminie: żadne nie miało terminu" },
    {
      name: "pl one still open",
      locale: "pl",
      pending: 1,
      text: "Zlecenia w terminie: żadne nie miało terminu, 1 nadal otwarte",
    },
    {
      name: "pl three still open",
      locale: "pl",
      pending: 3,
      text: "Zlecenia w terminie: żadne nie miało terminu, 3 nadal otwarte",
    },
    {
      name: "pl five still open",
      locale: "pl",
      pending: 5,
      text: "Zlecenia w terminie: żadne nie miało terminu, 5 nadal otwartych",
    },
  ] as const)("loopsNone: $name", ({ locale, pending, text }) => {
    expect(textTables[locale].notices.weekly.loopsNone(pending)).toBe(text);
  });

  test.each([
    { name: "pl none still open", pending: 0, text: "Zlecenia w terminie: 3 of 4, 2 of 5" },
    { name: "pl one still open", pending: 1, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 1 nadal otwarte" },
    { name: "pl three still open", pending: 3, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 3 nadal otwarte" },
    { name: "pl five still open", pending: 5, text: "Zlecenia w terminie: 3 of 4, 2 of 5, 5 nadal otwartych" },
  ] as const)("loops: $name", ({ pending, text }) => {
    expect(textTables.pl.notices.weekly.loops("3 of 4", "2 of 5", pending)).toBe(text);
  });

  test.each([
    {
      name: "en no p90 and no notices",
      locale: "en",
      p90: null,
      noticed: 0,
      text: "Urgent notice time: p90 – (0 notices)",
    },
    { name: "en one notice", locale: "en", p90: 12, noticed: 1, text: "Urgent notice time: p90 12 min (1 notice)" },
    {
      name: "pl no p90 and no notices",
      locale: "pl",
      p90: null,
      noticed: 0,
      text: "Czas powiadomienia o pilnej poczcie: p90 – (0 powiadomień)",
    },
    {
      name: "pl one notice",
      locale: "pl",
      p90: 12,
      noticed: 1,
      text: "Czas powiadomienia o pilnej poczcie: p90 12 min (1 powiadomienie)",
    },
    {
      name: "pl five notices",
      locale: "pl",
      p90: 12,
      noticed: 5,
      text: "Czas powiadomienia o pilnej poczcie: p90 12 min (5 powiadomień)",
    },
  ] as const)("urgent: $name", ({ locale, p90, noticed, text }) => {
    expect(textTables[locale].notices.weekly.urgent(p90, noticed, 0)).toBe(text);
  });

  test.each([
    {
      name: "en two unpriced calls",
      locale: "en",
      unpriced: 2,
      text: "Cost: $1.5 per mailbox per month (target ≤ $3), 2 calls without a price",
    },
    { name: "pl no unpriced calls", locale: "pl", unpriced: 0, text: "Koszt: $1,5 miesięcznie na skrzynkę (cel ≤ $3)" },
  ] as const)("cost: $name", ({ locale, unpriced, text }) => {
    expect(textTables[locale].notices.weekly.cost("1.5", 3, unpriced)).toBe(text);
  });
});

describe("action failed notice", () => {
  test.each([
    { name: "en no folder", locale: "en", folder: null, text: "The mail stays in its AI folder: move it by hand." },
    {
      name: "pl no folder",
      locale: "pl",
      folder: null,
      text: "Wiadomość zostaje w swoim folderze AI. Przenieś ją ręcznie.",
    },
    {
      name: "pl a folder",
      locale: "pl",
      folder: "AI/Info",
      text: "Wiadomość zostaje w folderze: AI/Info. Przenieś ją ręcznie.",
    },
  ] as const)("staysInAiFolder: $name", ({ locale, folder, text }) => {
    expect(textTables[locale].notices.actionFailed.staysInAiFolder(folder)).toBe(text);
  });
});
