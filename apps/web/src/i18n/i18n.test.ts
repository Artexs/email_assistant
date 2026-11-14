import { afterEach, describe, expect, test } from "bun:test";

import { en, enPlurals, type PluralKey, type TextKey } from "./en";
import { setLocaleForTest, t, tp } from "./index";
import { pl, plPlurals } from "./pl";

afterEach(() => setLocaleForTest("en"));

const textKeys = Object.keys(en) as TextKey[];
const pluralKeys = Object.keys(enPlurals) as PluralKey[];

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ""))].sort();
}

// Texts that read the same in Polish and English. The test keeps this list true in both directions.
const SAME_IN_BOTH: TextKey[] = [
  "brand", // the product name
  "menu_title", // "Menu" in both languages
  "tg_title", // the product name "Telegram"
  "tg_link_label", // "Link" in both languages
  "acct_language_pl", // each option is written in its own language
  "acct_language_en",
  "preset_interia", // provider names
  "preset_gmail",
  "preset_onet",
  "preset_wp",
  "preset_o2",
  "preset_icloud",
  "rule_kind_vip", // "VIP" in both languages
  "sig_counter", // numbers only
  "cat_info", // category "Info"
  "cat_spam", // category "Spam"
  "act_cat_info",
  "act_cat_spam",
  "act_tag_info",
  "act_tag_spam",
  "act_confidence", // a number and a percent sign
  "act_pick_ai", // a category name and "AI"
  "act_icon_right", // emoji only
  "act_icon_edit",
  "act_icon_undo",
  "browser_edge", // product names
  "browser_opera",
  "browser_firefox",
  "browser_chrome",
  "browser_safari",
  "os_android",
  "os_ios",
  "os_windows",
  "os_macos",
  "os_linux",
  "smtp_security_tls", // protocol names and ports
  "smtp_security_starttls",
  "act_action_at", // placeholders and a separator only
  "act_dlg_line",
  "sec_line", // placeholders and a separator only
];

function forms(table: Record<PluralKey, Record<string, string>>): string[] {
  return pluralKeys.flatMap((key) => Object.values(table[key] ?? {}));
}

describe("Polish dictionary", () => {
  test("every key has the same placeholders as English", () => {
    for (const key of textKeys) expect([key, placeholders(pl[key])]).toEqual([key, placeholders(en[key])]);
    expect(Object.keys(pl).sort()).toEqual([...textKeys].sort());
  });

  test("every plural form has the placeholders of English", () => {
    expect(Object.keys(plPlurals).sort()).toEqual([...pluralKeys].sort());
    for (const key of pluralKeys) {
      expect([key, placeholders(plPlurals[key].few)]).toEqual([key, placeholders(enPlurals[key].other)]);
      expect([key, placeholders(plPlurals[key].many)]).toEqual([key, placeholders(enPlurals[key].other)]);
      expect([key, placeholders(plPlurals[key].one)]).toEqual([key, placeholders(enPlurals[key].one)]);
    }
  });

  test("no text is empty", () => {
    const all = [
      ...Object.values(en),
      ...Object.values(pl),
      ...forms(enPlurals as Record<PluralKey, Record<string, string>>),
      ...forms(plPlurals),
    ];
    for (const text of all) expect(text.trim()).not.toBe("");
  });

  test("only the listed keys read the same in both languages", () => {
    const same = textKeys.filter((key) => pl[key] === en[key]);
    expect(same.sort()).toEqual([...SAME_IN_BOTH].sort());
  });

  test("the glossary words hold", () => {
    const all = [...Object.values(pl), ...forms(plPlurals)];
    for (const text of all) {
      expect(text.toLowerCase()).not.toContain("delegacj");
      expect(text.toLowerCase()).not.toContain("tryb cienia");
    }
  });

  test("Polish plurals pick one, few and many", () => {
    setLocaleForTest("pl");
    expect(tp("ob_rules", 1)).toBe("1 reguła");
    expect(tp("ob_rules", 2)).toBe("2 reguły");
    expect(tp("ob_rules", 5)).toBe("5 reguł");
    expect(tp("ob_rules", 22)).toBe("22 reguły");
    expect(tp("ob_rules", 12)).toBe("12 reguł");
    expect(t("rules_delete", { pattern: "firma.pl" })).toContain("firma.pl");
  });

  test("few and many differ in every plural key", () => {
    for (const key of pluralKeys) {
      expect(plPlurals[key].few).not.toBe(plPlurals[key].many);
      expect(plPlurals[key].one).not.toBe(plPlurals[key].few);
    }
  });

  test("the device line does not put an unknown system after 'na'", () => {
    setLocaleForTest("pl");
    const line = t("device_on", { browser: t("browser_unknown"), os: t("os_unknown") });
    expect(line).toBe("Nieznana przeglądarka (nieznany system)");
    expect(line).not.toContain("na nieznany system");
  });
});
