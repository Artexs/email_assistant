/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest, t, tp } from "../i18n";
import type { TextKey } from "../i18n";

afterEach(() => setLocaleForTest("en"));

// One fixed value per new key, in Polish and in English. A change of a text must change this list.
const NEW_TEXTS: Record<string, { en: string; pl: string }> = {
  dla_button: { en: "Delegate", pl: "Zleć" },
  dla_title: { en: "Delegate this mail", pl: "Zleć tę wiadomość" },
  dla_text: {
    en: "Pick a delegate. The assistant writes a draft to this person. Nothing goes out before you approve it.",
    pl: "Wybierz wykonawcę. Asystent przygotuje szkic dla tej osoby. Nic nie zostanie wysłane przed Twoim zatwierdzeniem.",
  },
  dla_select_label: { en: "Delegate", pl: "Wykonawca" },
  dla_select_placeholder: { en: "Pick a delegate", pl: "Wybierz wykonawcę" },
  dla_submit: { en: "Delegate", pl: "Zleć" },
  dla_done: {
    en: "Delegation drafted. Approve it to send.",
    pl: "Zlecenie przygotowane jako szkic. Zatwierdź je, aby je wysłać.",
  },
  dla_done_link: { en: "Open the approval", pl: "Otwórz zatwierdzenie" },
  dla_exists: { en: "This mail already has a delegation.", pl: "Ta wiadomość ma już zlecenie." },
  dla_exists_link: { en: "Open the delegation", pl: "Otwórz zlecenie" },
  dla_inactive: {
    en: "This delegate is off. Pick another delegate.",
    pl: "Ten wykonawca jest wyłączony. Wybierz innego wykonawcę.",
  },
  dla_drafts_off: {
    en: "Delegation needs assist mode with drafts on.",
    pl: "Zlecanie wymaga trybu asystenta z włączonymi szkicami.",
  },
  dla_not_delegable: { en: "This mail cannot be delegated.", pl: "Tej wiadomości nie można zlecić." },
  lset_title: { en: "Open loops", pl: "Otwarte sprawy" },
  lset_needs_sent: {
    en: "Turn on 'Track my sent mail' to use open loops.",
    pl: "Włącz „Śledź moją wysłaną pocztę”, aby korzystać z otwartych spraw.",
  },
  lset_wait_label: { en: "Wait before a follow-up", pl: "Czas oczekiwania przed przypomnieniem" },
  lset_wait_help: {
    en: "Counted on working days (Monday to Friday).",
    pl: "Liczone w dniach roboczych (od poniedziałku do piątku).",
  },
  lset_wait_toast: {
    en: "The wait before a follow-up is saved.",
    pl: "Zapisano czas oczekiwania przed przypomnieniem.",
  },
  lset_auto_label: { en: "Draft follow-ups automatically", pl: "Przygotowuj przypomnienia automatycznie" },
  lset_auto_help: {
    en: "Drafts still wait for your tap before they go out.",
    pl: "Szkice nadal czekają na Twoje zatwierdzenie, zanim zostaną wysłane.",
  },
  lset_auto_on_toast: {
    en: "Follow-ups are drafted automatically.",
    pl: "Przypomnienia będą przygotowywane automatycznie.",
  },
  lset_auto_off_toast: {
    en: "Follow-ups are not drafted automatically.",
    pl: "Przypomnienia nie będą przygotowywane automatycznie.",
  },
  tgc_title: { en: "New Telegram terms", pl: "Nowe zasady Telegrama" },
  tgc_confirm: { en: "Confirm", pl: "Potwierdź" },
  tgc_confirmed_toast: {
    en: "The new Telegram terms are confirmed.",
    pl: "Potwierdzono nowe zasady Telegrama.",
  },
};

describe("the texts of the Delegate action, the loop settings and the new terms (T2)", () => {
  test("every key has the fixed value in both languages", () => {
    for (const locale of ["en", "pl"] as const) {
      setLocaleForTest(locale);
      for (const [key, values] of Object.entries(NEW_TEXTS)) {
        expect({ locale, key, text: t(key as TextKey) }).toEqual({ locale, key, text: values[locale] });
      }
    }
  });

  test("the working-day plural has the right form in Polish and English", () => {
    setLocaleForTest("pl");
    expect([1, 2, 3, 4, 5, 10].map((n) => tp("lset_wait_days", n))).toEqual([
      "1 dzień roboczy",
      "2 dni robocze",
      "3 dni robocze",
      "4 dni robocze",
      "5 dni roboczych",
      "10 dni roboczych",
    ]);
    setLocaleForTest("en");
    expect([1, 3].map((n) => tp("lset_wait_days", n))).toEqual(["1 working day", "3 working days"]);
  });
});
