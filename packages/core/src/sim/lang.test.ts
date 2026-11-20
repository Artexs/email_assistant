import { describe, expect, test } from "bun:test";

import { detectLang } from "./lang";

describe("detectLang", () => {
  test("1 finds pl, en and de; a short text is unknown", () => {
    expect(detectLang("Dzień dobry, proszę o przesłanie raportu do piątku. Dziękuję")).toBe("pl");
    expect(detectLang("Hi Anna, could you send the report by Friday? Thanks")).toBe("en");
    expect(detectLang("Guten Tag, bitte schicken Sie mir den Bericht bis Freitag")).toBe("de");
    expect(detectLang("OK")).toBe("unknown");
  });
  test("a text of Polish letters and no stopword counts each word with such a letter as a hit", () => {
    expect(detectLang("Zażółć gęślą jaźń")).toBe("pl");
    expect(detectLang("Zażółć gęślą")).toBe("unknown");
  });

  test("a top score of exactly 3 hits is enough; 2 hits is unknown", () => {
    expect(detectLang("you that for")).toBe("en");
    expect(detectLang("you that")).toBe("unknown");
  });

  test("a top score of exactly 1.5 times the second is enough", () => {
    expect(detectLang("you that for der die")).toBe("en");
  });

  test("a top score of less than 1.5 times the second is unknown", () => {
    expect(detectLang("you that for der die das")).toBe("unknown");
    expect(detectLang("you that for with from der die das ist")).toBe("unknown");
  });
});
