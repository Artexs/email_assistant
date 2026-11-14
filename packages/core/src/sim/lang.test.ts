import { describe, expect, test } from "bun:test";

import { detectLang } from "./lang";

describe("detectLang", () => {
  test("1 finds pl, en and de; a short text is unknown", () => {
    expect(detectLang("Dzień dobry, proszę o przesłanie raportu do piątku. Dziękuję")).toBe("pl");
    expect(detectLang("Hi Anna, could you send the report by Friday? Thanks")).toBe("en");
    expect(detectLang("Guten Tag, bitte schicken Sie mir den Bericht bis Freitag")).toBe("de");
    expect(detectLang("OK")).toBe("unknown");
  });
});
