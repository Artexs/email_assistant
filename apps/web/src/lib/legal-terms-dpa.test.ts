import { userLocales, type UserLocale } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { pl } from "../i18n/pl";
import { isAllowedPlaceholder, legalPlaceholders } from "./legal";
import { findPlaceholders, headingTitles, readLegalSource } from "./legal-checks";

// The terms of service and the data processing agreement. The texts are drafts: each fact that no source
// states is a placeholder.

const termsHeadings: Record<UserLocale, string[]> = {
  en: [
    "The service",
    "Accounts",
    "Plan state",
    "Your mailbox",
    "AI output",
    "Availability",
    "End and deletion",
    "Liability and law",
    "Changes",
  ],
  pl: [
    "Usługa",
    "Konta",
    "Stan planu",
    "Twoja skrzynka",
    "Wyniki AI",
    "Dostępność",
    "Zakończenie i usunięcie",
    "Odpowiedzialność i prawo",
    "Zmiany",
  ],
};

const dpaHeadings: Record<UserLocale, string[]> = {
  en: [
    "Parties and subject",
    "Nature and purpose",
    "Data and data subjects",
    "Instructions",
    "Confidentiality",
    "Security measures",
    "Sub-processors",
    "Help with requests",
    "Breaches",
    "End",
    "Audits",
  ],
  pl: [
    "Strony i przedmiot",
    "Charakter i cel",
    "Dane i osoby",
    "Polecenia",
    "Poufność",
    "Środki bezpieczeństwa",
    "Podprocesorzy",
    "Pomoc przy żądaniach",
    "Naruszenia",
    "Zakończenie",
    "Audyty",
  ],
};

describe("the terms of service sources", () => {
  for (const lang of userLocales) {
    const source = readLegalSource(lang, "terms");

    test(`1. ${lang}: the nine ## headings are in the fixed order`, () => {
      expect(headingTitles(source)).toEqual(termsHeadings[lang]);
    });

    test(`2. ${lang}: the terms hold the liability and governing law placeholders`, () => {
      const found = findPlaceholders(source);
      expect(found).toContain("<to confirm: liability>");
      expect(found).toContain("<to confirm: governing law>");
    });

    test(`3. ${lang}: every placeholder is allowed`, () => {
      expect(findPlaceholders(source).filter((placeholder) => !isAllowedPlaceholder(placeholder))).toEqual([]);
    });

    test(`${lang}: the terms have no table (the e2e test checks the page)`, () => {
      expect(source).not.toMatch(/^\|/m);
    });

    // The delete lists of the terms, the privacy policy and the DPA name the same things: the push devices go with the organization.
    test(`4. ${lang}: the delete lists of the terms and the DPA name the push devices`, () => {
      const word = lang === "en" ? "push devices" : "urządzenia push";
      expect({ lang, doc: "terms", found: source.includes(word) }).toEqual({ lang, doc: "terms", found: true });
      expect({ lang, doc: "dpa", found: readLegalSource(lang, "dpa").includes(word) }).toEqual({
        lang,
        doc: "dpa",
        found: true,
      });
    });
  }
});

describe("the data processing agreement sources", () => {
  for (const lang of userLocales) {
    const source = readLegalSource(lang, "dpa");

    test(`1. ${lang}: the eleven ## headings are in the fixed order`, () => {
      expect(headingTitles(source)).toEqual(dpaHeadings[lang]);
    });

    test(`2. ${lang}: the DPA holds the processor and the controller placeholders`, () => {
      const found = findPlaceholders(source);
      expect(found).toContain("<provider name>");
      expect(found).toContain("<organization name>");
    });

    test(`3. ${lang}: every placeholder is allowed`, () => {
      expect(findPlaceholders(source).filter((placeholder) => !isAllowedPlaceholder(placeholder))).toEqual([]);
    });

    test(`${lang}: the open points are placeholders`, () => {
      const found = findPlaceholders(source);
      for (const open of [
        "staff",
        "objection period",
        "audit rights",
        "sub-processor contracts",
        "help with Articles 32 to 36",
        "proof of compliance",
      ])
        expect(found).toContain(`<to confirm: ${open}>`);
    });

    test(`${lang}: the DPA links the data categories of the privacy policy`, () => {
      expect(source).toContain(`](/legal/${lang}/privacy)`);
    });
  }

  test("the en DPA says controller and processor, and never customer", () => {
    const source = readLegalSource("en", "dpa");
    expect(source).toMatch(/controller/i);
    expect(source).toMatch(/processor/i);
    expect(source).not.toMatch(/customer/i);
  });

  test("the pl DPA says administrator and podmiot przetwarzający, and never klient", () => {
    const source = readLegalSource("pl", "dpa");
    expect(source).toMatch(/administrator/i);
    expect(source).toMatch(/podmiot\w* przetwarzając/i);
    expect(source).not.toMatch(/klient/i);
  });
});

describe("the placeholder list", () => {
  test("3. the organization name placeholder is listed", () => {
    expect(legalPlaceholders).toContain("<organization name>");
    expect(isAllowedPlaceholder("<organization name>")).toBe(true);
  });
});

describe("the mode names", () => {
  // The panel calls the modes "Tryb podglądu" and "Tryb asystenta" (`mb_mode_shadow`, `mb_mode_assist`). The texts use the same names.
  test("the pl privacy policy and terms name the modes as the panel does", () => {
    expect(pl.mb_mode_assist.toLowerCase()).toBe("tryb asystenta");
    expect(pl.mb_mode_shadow.toLowerCase()).toBe("tryb podglądu");
    for (const doc of ["privacy", "terms"] as const) {
      const source = readLegalSource("pl", doc);
      expect(source).toContain("trybie asystenta");
      expect(source).toContain("trybie podglądu");
      expect(source).not.toMatch(/tryb\w* asysty\b/i);
    }
  });
});
