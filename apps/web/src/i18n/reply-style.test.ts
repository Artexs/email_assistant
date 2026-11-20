import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { pl } from "./pl";

// The texts of the reply drafts switch and the style card. The Polish values are fixed here on purpose: a reword changes
// this table, and the review of the Polish text reads it here. The words follow the glossary: "szkic", "skrzynka", "zatwierdzenie";
// no text speaks of the user in a gendered past tense.
const PL_TEXTS = {
  switch_reply_drafts: "Szkice odpowiedzi",
  rs_switch_help:
    "Przygotowuje szkic odpowiedzi na pocztę, która wymaga Twojej odpowiedzi. Nic nie zostanie wysłane bez Twojego zatwierdzenia.",
  rs_switch_oauth: "Szkice odpowiedzi działają na razie tylko w skrzynkach połączonych hasłem.",
  rs_title: "Nazwa, podpis i styl pisania",
  rs_help:
    "Nazwa i podpis trafiają do każdej wiadomości, którą asystent pisze dla Ciebie. Puste pole oznacza, że obowiązuje tekst pokazany pod nim.",
  rs_name_label: "Nazwa wyświetlana",
  rs_signature_label: "Podpis",
  rs_style_label: "Styl pisania",
  rs_in_use: "Obowiązuje: {text}",
  rs_style_help: "Opisz, jak asystent ma pisać Twoje odpowiedzi. Ten tekst dotyczy tylko szkiców odpowiedzi.",
  rs_form_title: "Ustaw styl pisania w krótkim formularzu",
  rs_form_address: "Forma zwracania się",
  rs_address_formal: "Formalna",
  rs_address_first_name: "Po imieniu",
  rs_address_mirror: "Tak jak nadawca",
  rs_form_greeting: "Powitanie",
  rs_form_sign_off: "Pożegnanie",
  rs_form_length: "Długość",
  rs_length_short: "Krótka",
  rs_length_normal: "Zwykła",
  rs_apply: "Zastosuj",
  rs_apply_help:
    "Przycisk „Zastosuj” zastępuje styl pisania powyżej. Nic nie zostanie zapisane, dopóki nie wybierzesz „Zapisz”.",
  rs_saved_toast: "Zapisano nazwę, podpis i styl pisania.",
  rs_err_line_break: "Nazwa musi mieścić się w jednym wierszu.",
  rs_err_bad_character: 'Nazwa nie może zawierać znaków < > " ani @.',
  rs_err_too_long: "Ten tekst jest za długi.",
  rs_preview: "Podgląd",
  rs_preview_help:
    "Podgląd tworzy odpowiedź na stałą przykładową wiadomość. Używa wartości z pól powyżej, także tych, których nie zapisano.",
  rs_preview_title: "Przykładowa odpowiedź",
  rs_preview_note: "To jest przykład. Nic nie zostało wysłane.",
  rs_preview_llm_off: "Podgląd nie jest dostępny na tym serwerze.",
  rs_preview_cap: "Dzienny limit wywołań AI jest wykorzystany. Spróbuj jutro.",
  rs_preview_failed: "Asystent nie mógł napisać przykładu. Spróbuj ponownie.",
  rs_preview_limit: "Wykorzystano dziś wszystkie podglądy tej skrzynki. Spróbuj jutro.",
  rs_preview_busy: "Podgląd tej skrzynki już trwa. Poczekaj, aż się zakończy.",
  rs_samples: "Pokaż 3 przykładowe szkice",
  rs_samples_help:
    "Asystent napisze odpowiedzi na maksymalnie 3 najnowsze wiadomości z ostatnich 7 dni, które czekają na odpowiedź. Możesz o to poprosić raz dziennie dla każdej skrzynki.",
  rs_samples_note: "Przykłady nie trafiają do folderu szkiców w skrzynce i nie można ich wysłać.",
  rs_samples_title: "Przykładowe szkice odpowiedzi na Twoje ostatnie wiadomości",
  rs_samples_mail: "Odpowiedź na: {subject}",
  rs_samples_no_subject: "(bez tematu)",
  rs_samples_waiting: "Asystent pisze przykłady…",
  rs_samples_none: "Brak wiadomości z ostatnich 7 dni, na które asystent może napisać przykład.",
  rs_samples_limit: "Przykłady dla tej skrzynki były już dziś zamówione. Spróbuj ponownie później.",
  rs_samples_oauth: "Przykładowe szkice działają na razie tylko w skrzynkach połączonych hasłem.",
  rs_samples_llm_off: "Przykładowe szkice nie są dostępne na tym serwerze.",
  rs_samples_failed: "Asystent nie mógł napisać tego przykładu.",
  rs_samples_no_draft: "Asystent nie napisał przykładu dla tej wiadomości.",
  rs_samples_slow: "Przykłady powstają dłużej niż zwykle. Odśwież stronę za minutę.",
} as const;

const ownKeys = Object.keys(PL_TEXTS) as (keyof typeof PL_TEXTS)[];

describe("the texts of the style card (F115 stage 11)", () => {
  test("every new key is in en and in pl, and the Polish text is the fixed one", () => {
    for (const key of ownKeys) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(pl[key], key).toBe(PL_TEXTS[key]);
    }
  });

  test("the `rs_` keys of en and pl are the same set as the table, so a key that is added needs a Polish text here", () => {
    const rs = (table: object) =>
      Object.keys(table)
        .filter((key) => key.startsWith("rs_"))
        .sort();
    expect(rs(en)).toEqual(rs(PL_TEXTS));
    expect(rs(pl)).toEqual(rs(PL_TEXTS));
  });

  test("the English help line is the text of the stage", () => {
    expect(en.rs_switch_help).toBe("Drafts a reply for mail that needs your answer. Nothing is sent without your tap.");
    expect(en.rs_switch_oauth).toBe("Reply drafts work only for mailboxes connected with a password for now.");
    expect(en.rs_preview_note).toBe("This is a sample. Nothing was sent.");
  });

  test("the old organization signature keys that the read-only card does not use are gone", () => {
    for (const key of ["sig_help", "sig_label", "sig_saved_toast"]) {
      expect(Object.hasOwn(en, key), key).toBe(false);
      expect(Object.hasOwn(pl, key), key).toBe(false);
    }
  });
});
