import { userLocales } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { checkLegalSource, findPlaceholders, headingCount, readLegalSource, strayLegalFiles } from "./legal-checks";
import { isAllowedPlaceholder, legalDocs } from "./legal";

describe("findPlaceholders", () => {
  test("6. finds each escaped placeholder, in order", () => {
    expect(findPlaceholders("a \\<provider name> b \\<to confirm: x>")).toEqual(["<provider name>", "<to confirm: x>"]);
  });

  test("an unescaped angle bracket is not a placeholder", () => {
    expect(findPlaceholders("1 < 2 and <b>")).toEqual([]);
  });
});

describe("checkLegalSource", () => {
  test("6. passes on an allowed placeholder", () => {
    expect(checkLegalSource("Contact: \\<contact>. Also \\<to confirm: the region>.")).toEqual([]);
  });

  test("6. fails on a placeholder that is not in the list", () => {
    expect(checkLegalSource("Name: \\<provider>.")).toEqual(["placeholder is not in the list: <provider>"]);
  });

  test("6. fails on raw HTML", () => {
    expect(checkLegalSource("a <b>bold</b> word")).toHaveLength(1);
    expect(checkLegalSource("<!-- note -->")).toHaveLength(1);
    expect(checkLegalSource("see <https://example.com>")).toHaveLength(1);
  });

  test("isAllowedPlaceholder takes the list and `<to confirm: …>` only", () => {
    expect(isAllowedPlaceholder("<address>")).toBe(true);
    expect(isAllowedPlaceholder("<to confirm: >")).toBe(false);
    expect(isAllowedPlaceholder("<to confirm: x>")).toBe(true);
    expect(isAllowedPlaceholder("<name>")).toBe(false);
  });
});

describe("the six legal sources", () => {
  test("only the six files exist", () => {
    expect(strayLegalFiles()).toEqual([]);
  });

  for (const lang of userLocales)
    for (const doc of legalDocs)
      test(`${lang}/${doc}.md passes the source check`, () => {
        expect(checkLegalSource(readLegalSource(lang, doc))).toEqual([]);
      });

  for (const doc of legalDocs)
    test(`7. ${doc}: pl and en have the same number of ## headings`, () => {
      const counts = { pl: headingCount(readLegalSource("pl", doc)), en: headingCount(readLegalSource("en", doc)) };
      expect(counts.pl).toBeGreaterThan(0);
      expect(counts.pl).toBe(counts.en);
    });
});
