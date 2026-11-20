import {
  compareLegalVersions,
  OPEN_LOOPS_CONSENT_SINCE,
  parseLegalVersion,
  REPLY_CONSENT_SINCE,
  TELEGRAM_CONSENT_VERSION,
} from "@ea/core";
import { afterEach, describe, expect, test } from "bun:test";

import { en, enPlurals, type PluralKey, type TextKey } from "./en";
import { setLocaleForTest, t, tp } from "./index";
import { pl, plPlurals } from "./pl";

// Orders two legal versions with the shared parser (the counter `.10` is after `.9`; string order is not). A version that does not
// parse fails the test with its name.
function versionIsBefore(older: string, newer: string, names: [string, string]): boolean {
  const first = parseLegalVersion(older);
  const second = parseLegalVersion(newer);
  if (first === null) throw new Error(`${names[0]} "${older}" is not a legal version`);
  if (second === null) throw new Error(`${names[1]} "${newer}" is not a legal version`);
  return compareLegalVersions(first, second) < 0;
}

afterEach(() => setLocaleForTest("en"));

const textKeys = Object.keys(en) as TextKey[];
const pluralKeys = Object.keys(enPlurals) as PluralKey[];

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ""))].sort();
}

// Texts that read the same in Polish and English. The test keeps this list true in both directions.
const SAME_IN_BOTH: TextKey[] = [
  "brand", // the product name
  "rp_reply_to", // the name of the mail header "Reply-To"
  "rp_instruction_count", // "{n} / {max}"
  "menu_title", // "Menu" in both languages
  "tg_title", // the product name "Telegram"
  "nr_telegram", // the product name "Telegram", an option of the route select
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
  "sender_rel_vip",
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
  "nav_operator", // "Operator" in both languages
  "op_col_plan", // "Plan" in both languages
  "op_plan_state",
  "op_notice_line", // placeholders and a separator only
  "stats_minutes", // a number, "min" and a number in both languages
  "appr_dur_min", // a number and "min" in both languages
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

describe("the Telegram consent text", () => {
  // Attachment names and sizes reach Telegram in notices: the consent text names them, and its version moved with it.
  test("names the attachments in both languages", () => {
    expect(en.tg_consent_text).toContain("names (or file types) and sizes of their attachments");
    expect(pl.tg_consent_text).toContain("nazwy (lub typy plików) i rozmiary ich załączników");
  });

  // Loop lines and follow-up cards carry recipients, the ask and the promise: the text ends with a sentence about them.
  test("T6 ends with the open-loops sentence in both languages", () => {
    expect(en.tg_consent_text).toEndWith(
      "If you turn on open loops: who you wait for (addresses from your sent mail), a short description of what you asked or promised, the due date taken from your sent mail, the subject of the mail, and follow-up drafts with their recipients. Open-loop lines never hold mail bodies."
    );
    expect(pl.tg_consent_text).toEndWith(
      "Jeśli włączysz otwarte sprawy: na kogo czekasz (adresy z wysłanej poczty), krótki opis tego, o co prosisz lub co obiecujesz, termin z Twojej wysłanej poczty, temat wiadomości oraz szkice przypomnień z ich adresatami. Linie otwartych spraw nigdy nie zawierają treści wiadomości."
    );
  });

  test("T7 the current version is not older than the open-loops version", () => {
    expect(
      versionIsBefore(TELEGRAM_CONSENT_VERSION, OPEN_LOOPS_CONSENT_SINCE, [
        "TELEGRAM_CONSENT_VERSION",
        "OPEN_LOOPS_CONSENT_SINCE",
      ])
    ).toBe(false);
  });

  // A Telegram user is covered for reply data only by a consent version that offered a text naming it. While
  // The version `REPLY_CONSENT_SINCE` covers users who consent to a text that names the reply drafts and the other recipients'
  // addresses. While it is above the current version nobody is covered; once it is not above, both consent texts must name
  // that data, or this test fails.
  test("T8 the reply version is not offered before its text names reply data", () => {
    if (
      versionIsBefore(TELEGRAM_CONSENT_VERSION, REPLY_CONSENT_SINCE, [
        "TELEGRAM_CONSENT_VERSION",
        "REPLY_CONSENT_SINCE",
      ])
    ) {
      return;
    }
    expect(en.tg_consent_text).toContain("reply drafts that the AI writes");
    expect(en.tg_consent_text).toContain("Reply-To addresses of the original mail");
    expect(en.tg_consent_text).toContain("(To, Cc)");
    expect(pl.tg_consent_text).toContain("szkice odpowiedzi");
    expect(pl.tg_consent_text).toContain("adresy Reply-To oryginalnej wiadomości");
    expect(pl.tg_consent_text).toContain("(Do, DW)");
  });

  test("T7b the open-loops version is newer than the F109 attachment version", () => {
    expect(
      versionIsBefore("2026-11-15", OPEN_LOOPS_CONSENT_SINCE, [
        "the attachment consent version",
        "OPEN_LOOPS_CONSENT_SINCE",
      ])
    ).toBe(true);
  });
});

// The settled words of the notify cards and the time-zone help.
describe("the texts of the quiet hours and report channel cards", () => {
  test("the Polish channel help uses the settled words: komunikaty, w Telegramie, raporty zaufania", () => {
    // "Powiadomienia" is the mail category; the settled word for what the bot sends is "komunikaty" (tg_intro).
    expect(pl.notify_channel_help).not.toContain("owiadomienia");
    expect(pl.notify_channel_help).toContain("w Telegramie");
    expect(pl.notify_channel_help).not.toContain("na Telegram");
    expect(pl.notify_channel_help).toContain("Pilne komunikaty");
    expect(pl.notify_channel_help).toContain("raporty zaufania");
    expect(en.notify_channel_help).toContain("trust reports");
  });

  test("the no-mailbox text uses the verb of the Connect button (Połącz)", () => {
    expect(pl.notify_no_mailbox).toContain("połącz skrzynkę");
    expect(pl.notify_no_mailbox).not.toContain("podłącz");
  });

  test("the channel options read in parallel: Only Telegram, Only mail", () => {
    expect(pl.notify_channel_telegram).toBe("Tylko Telegram");
    expect(pl.notify_channel_mail).toBe("Tylko poczta");
    expect(en.notify_channel_telegram).toBe("Only Telegram");
    expect(en.notify_channel_mail).toBe("Only mail");
  });

  test("the time-zone help names 22:00–07:00 only as the default, as the quiet hours of a member can differ", () => {
    expect(en.tz_note).toContain("by default 22:00–07:00");
    expect(pl.tz_note).toContain("domyślnie 22:00–07:00");
    expect(pl.tz_note).not.toContain("cisza nocna");
  });

  test("the too-long message names the limit in both languages", () => {
    expect(en.quiet_too_long).toContain("18");
    expect(pl.quiet_too_long).toContain("18");
  });

  test("the Help link and the What is new card texts have a fixed value in both languages (F112 stage 15)", () => {
    expect([en.help_link, en.whats_new_title, en.whats_new_all, en.whats_new_dismiss]).toEqual([
      "Help and guides",
      "What is new",
      "All changes for users",
      "Close the list of new features",
    ]);
    expect([pl.help_link, pl.whats_new_title, pl.whats_new_all, pl.whats_new_dismiss]).toEqual([
      "Pomoc i poradniki",
      "Co nowego",
      "Wszystkie zmiany dla użytkowników",
      "Zamknij listę nowości",
    ]);
  });
});
