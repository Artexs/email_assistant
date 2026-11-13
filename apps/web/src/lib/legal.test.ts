import { describe, expect, test } from "bun:test";

import { legalLang, legalPath } from "./legal";

describe("legalLang", () => {
  test("a Polish browser language gets Polish, in any case", () => {
    expect(legalLang("pl-PL")).toBe("pl");
    expect(legalLang("PL")).toBe("pl");
  });

  test("every other language, and none, gets English", () => {
    expect(legalLang("en-US")).toBe("en");
    expect(legalLang(undefined)).toBe("en");
  });
});

describe("legalPath", () => {
  test("joins the language and the document", () => {
    expect(legalPath("en", "dpa")).toBe("/legal/en/dpa");
    expect(legalPath("pl", "terms")).toBe("/legal/pl/terms");
  });
});
