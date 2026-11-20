import { userLocales, type UserLocale } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { isAllowedPlaceholder, legalPlaceholders } from "./legal";
import { findPlaceholders, headingTitles, readLegalSource } from "./legal-checks";

// The privacy policy. The texts are drafts: each fact that no source states is a placeholder.

const headings: Record<UserLocale, string[]> = {
  en: [
    "Who is responsible",
    "What data",
    "Why and on what basis",
    "How long",
    "Who receives data",
    "AI and decisions",
    "Your rights",
    "Security",
    "Changes",
  ],
  pl: [
    "Kto odpowiada",
    "Jakie dane",
    "Cel i podstawa",
    "Jak długo",
    "Kto otrzymuje dane",
    "AI i decyzje",
    "Twoje prawa",
    "Bezpieczeństwo",
    "Zmiany",
  ],
};

// Features that the policy must not describe until they ship.
const plannedFeatures = /OAuth|Vertex|EU endpoint|endpoint w UE|sender profile|profil(e|i) nadawc/i;

describe("the privacy policy sources", () => {
  for (const lang of userLocales) {
    const source = readLegalSource(lang, "privacy");

    test(`1. ${lang}: the nine ## headings are in the fixed order`, () => {
      expect(headingTitles(source)).toEqual(headings[lang]);
    });

    test(`2. ${lang}: the policy holds the provider name and contact placeholders`, () => {
      const found = findPlaceholders(source);
      expect(found).toContain("<provider name>");
      expect(found).toContain("<contact>");
    });

    test(`3. ${lang}: every placeholder is in the list or is a to-confirm placeholder`, () => {
      const found = findPlaceholders(source);
      expect(found.length).toBeGreaterThan(0);
      expect(found.filter((placeholder) => !isAllowedPlaceholder(placeholder))).toEqual([]);
    });

    test(`3. ${lang}: the backup retention placeholder is used and listed`, () => {
      expect(findPlaceholders(source)).toContain("<backup retention>");
      expect(legalPlaceholders).toContain("<backup retention>");
    });

    test(`${lang}: the text names the kept technical ids`, () => {
      expect(source).toContain("Message-ID");
    });

    test(`${lang}: the text does not describe a planned feature`, () => {
      expect(source).not.toMatch(plannedFeatures);
    });

    // The phone channel: the push services are named, and so are the two Telegram levels (the registry row `web-push` has the details).
    test(`4. ${lang}: the text names the push services and both Telegram levels`, () => {
      for (const word of ["Google FCM", "Mozilla", "Apple", "Microsoft", "`minimal`", "`full`"])
        expect({ word, found: source.includes(word) }).toEqual({ word, found: true });
    });
  }
});
