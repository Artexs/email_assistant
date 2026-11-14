import { afterEach, describe, expect, test } from "bun:test";

import { dateLocale, getLocale, initLocale, setLocale, setLocaleForTest, subscribeLocale, t, tp } from "./index";

afterEach(() => setLocaleForTest("en"));

describe("t", () => {
  test("fills the placeholders and keeps unknown names", () => {
    expect(t("rules_delete", { pattern: "firma.pl" })).toBe("Delete the rule firma.pl");
    expect(t("rules_delete", { other: "x" })).toBe("Delete the rule {pattern}");
  });
});

describe("tp", () => {
  test("English has a singular and a plural form", () => {
    expect(tp("ob_rules", 1)).toBe("1 rule");
    expect(tp("ob_rules", 0)).toBe("0 rules");
    expect(tp("ob_rules", 5)).toBe("5 rules");
    expect(tp("expired_suffix", 1)).toBe("1 planned action was cancelled.");
    expect(tp("expired_suffix", 3)).toBe("3 planned actions were cancelled.");
  });

  test("Polish picks one, few and many, and few differs from many", () => {
    setLocaleForTest("pl");
    expect(getLocale()).toBe("pl");
    expect(dateLocale()).toBe("pl-PL");
    expect(tp("ob_rules", 1)).toBe("1 reguła");
    expect(tp("ob_rules", 2)).toBe("2 reguły");
    expect(tp("ob_rules", 5)).toBe("5 reguł");
    expect(tp("auth_error_banner", 3)).toBe("3 skrzynki mają błąd logowania.");
    expect(tp("auth_error_banner", 5)).toBe("5 skrzynek ma błąd logowania.");
    expect(tp("ob_rules", 2)).not.toBe(tp("ob_rules", 5).replace("5", "2"));
  });
});

describe("setLocale", () => {
  test("notifies once per change and not for the same value", () => {
    let calls = 0;
    const unsubscribe = subscribeLocale(() => {
      calls += 1;
    });
    setLocale("pl");
    expect(calls).toBe(1);
    setLocale("pl");
    expect(calls).toBe(1);
    unsubscribe();
    setLocale("en");
    expect(calls).toBe(1);
  });
});

describe("initLocale", () => {
  test("without window, storage or navigator the locale is English", () => {
    expect(initLocale()).toBe("en");
  });
});
