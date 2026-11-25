import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { pl } from "./pl";

// The Polish texts of the reply kind on the approvals page and of the Draft reply button. The values are fixed here on purpose: a reword
// changes this table, and the review of the Polish text reads it here. The register is "ty" (informal); the words follow the glossary:
// "szkic", "skrzynka", "zatwierdzenie", "odbiorca", "DW" for Cc; no text speaks of the user in a gendered past tense.
const PL_TEXTS = {
  // The reply kind on the approvals page: gaps, recipients, redraft, the answers of the reply routes
  rp_gaps_title: "Uzupełnij przed wysłaniem",
  rp_gaps_help: "Wybierz Edytuj i zastąp każdą lukę właściwym tekstem.",
  rp_approve_gaps: "Zatwierdzenie jest wyłączone, dopóki w szkicu są luki.",
  rp_reply_to: "Reply-To",
  rp_mode_from: "Ta odpowiedź trafi do nadawcy.",
  rp_mode_all: "Ta odpowiedź trafi do nadawcy. Pozostali odbiorcy wiadomości dostaną kopię (DW).",
  rp_mode_reply_to: "Ta odpowiedź trafi na adres Reply-To z wiadomości, a nie do nadawcy.",
  rp_address_unusual:
    "Sprawdź ten adres: zawiera znaki spoza podstawowego alfabetu łacińskiego; niektóre wyglądają jak inne litery.",
  rp_sent_hidden: "Nie widzę Twojej wysłanej poczty. Sprawdź, czy ta wiadomość nie ma już odpowiedzi.",
  rp_instruction_label: "Napisz asystentowi, co zmienić",
  rp_instruction_help: "Napisz jedną linijkę. Asystent napisze nową wersję.",
  rp_instruction_count: "{n} / {max}",
  rp_redraft: "Napisz inaczej",
  rp_redraft_left: "Pozostałe nowe wersje dla tej wiadomości: {n}",
  rp_redraft_none: "Limit nowych wersji dla tej wiadomości został wykorzystany.",
  rp_reply_all: "Odpowiedz wszystkim",
  rp_reply_all_adds: "Do kopii (DW) trafią:",
  rp_use_reply_to: "Użyj Reply-To",
  rp_use_reply_to_to: "Odpowiedź trafi na ten adres zamiast do nadawcy:",
  rp_drafting: "Piszę szkic…",
  rp_redraft_done: "Nowa wersja jest gotowa.",
  rp_poll_timeout: "Szkic powstaje dłużej niż zwykle. Odśwież stronę za chwilę.",
  rp_send_note_editable:
    "System wyśle wiadomość po Twoim zatwierdzeniu. Edytuj tutaj albo edytuj i wyślij w programie pocztowym.",
  rp_edit_hint_editable: "Edytuj tutaj albo edytuj i wyślij w programie pocztowym.",
  rp_edit_gaps_hint: "Zastąp każdą lukę w podwójnych nawiasach kwadratowych właściwym tekstem.",
  // The 400 and 409 answers of the reply routes
  rp_err_too_many_recipients: "Zbyt wielu odbiorców: odpowiedź może trafić najwyżej do 10 dodatkowych osób.",
  rp_err_no_reply_to: "Ta wiadomość nie ma innego adresu Reply-To.",
  rp_err_no_others: "Ta wiadomość nie ma innych odbiorców.",
  rp_err_bad_recipient: "Nie można użyć jednego z adresów tej wiadomości. Napisz tę odpowiedź w programie pocztowym.",
  rp_err_unchanged: "Szkic jest już zaadresowany do tych odbiorców.",
  rp_err_not_editable: "Tego szkicu nie można zmienić.",
  rp_err_instruction: "Napisz jedną linijkę, od 1 do 300 znaków.",
  rp_err_drafts_off: "Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w ustawieniach skrzynki.",
  rp_err_redraft_limit: "Ten szkic ma już 5 nowych wersji. Edytuj go tutaj.",
  // Why no draft was made (409 `blocked`)
  rp_blocked_not_checked: "Ta wiadomość nie została sprawdzona. Brak szkicu.",
  rp_blocked_category: "Ta wiadomość nie wymaga odpowiedzi.",
  rp_blocked_junk_source: "Ta wiadomość pochodzi z folderu spam. Brak szkicu.",
  rp_blocked_not_a_person: "Ta wiadomość jest automatyczna albo z listy mailingowej. Brak szkicu.",
  rp_blocked_own_mailbox: "Ta wiadomość pochodzi z Twojej własnej skrzynki. Brak szkicu.",
  rp_blocked_suspicious: "Ta wiadomość wygląda podejrzanie. Brak szkicu.",
  rp_blocked_calendar: "To zaproszenie z kalendarza. Odpowiedz na nie w kalendarzu.",
  rp_blocked_answered: "Ta wiadomość ma już odpowiedź.",
  rp_blocked_too_old: "Ta wiadomość jest za stara na szkic.",
  rp_blocked_language: "Nie można ustalić języka tej wiadomości. Brak szkicu.",
  rp_blocked_open_newer: "Nowsza wiadomość w tym wątku ma już szkic.",
  rp_blocked_oauth_mailbox: "Szkice odpowiedzi nie działają jeszcze dla tego typu skrzynki.",
  rp_blocked_policy_changed: "Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w ustawieniach skrzynki.",
  // How a request that a user waited for ended with no new version
  rp_result_needs_facts: "Brak szkicu: odpowiedź wymaga faktów, których nie ma w wiadomości. Napisz ją samodzielnie.",
  rp_result_not_a_reply: "Brak szkicu: ta wiadomość nie wymaga odpowiedzi.",
  rp_result_unsafe_request: "Brak szkicu: ta wiadomość prosi o coś, co wymaga Twojej własnej decyzji.",
  rp_result_no_text: "Brak szkicu: treść wiadomości nie jest już zapisana.",
  rp_result_timeout: "Szkic powstawał za długo. Spróbuj jeszcze raz.",
  rp_result_llm_cap: "Dzienny limit wywołań AI dla tej skrzynki został wykorzystany. Spróbuj jutro.",
  rp_result_llm_error: "Usługa AI zawiodła. Spróbuj później.",
  rp_result_checks: "Szkic nie przeszedł kontroli bezpieczeństwa. Spróbuj ponownie albo napisz odpowiedź samodzielnie.",
  rp_result_output: "AI nie dało użytecznej odpowiedzi. Spróbuj ponownie.",
  rp_result_internal: "Coś poszło nie tak. Spróbuj później.",
  rp_result_closed: "Ten szkic został zamknięty; nic się nie zmieniło.",
  rp_result_changed: "W międzyczasie inna wersja zastąpiła ten szkic. Użyj najnowszej wersji.",
  rp_result_off: "Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w ustawieniach skrzynki.",
  rp_result_org_off: "Szkice odpowiedzi są wyłączone dla Twojej organizacji.",
  rp_result_mail_gone: "Wiadomość nie jest już dostępna.",
  rp_result_generic: "Nie powstał żaden szkic.",
  rp_result_superseded: "Nowsza wiadomość w tym wątku ma już szkic.",
  // The state of a draft that the system closed (an expired send)
  rp_end_answered: "Na tę wiadomość już odpowiedziano. System nic nie wysłał.",
  rp_end_sent_by_user: "Wygląda na to, że odpowiedź wysłano z programu pocztowego. System nic nie wysłał.",
  rp_end_newer_mail:
    "W tym wątku pojawiła się nowsza wiadomość. Nic nie wysłano. Przeczytaj nowszą wiadomość; może pojawić się nowy szkic.",
  rp_end_original_moved:
    "Wiadomość przeniesiono do innego folderu. Nic nie wysłano. Jeśli nadal chcesz odpowiedzieć, zrób to z jej nowego miejsca.",
  rp_end_suspicious:
    "Po utworzeniu szkicu wiadomość oznaczono jako podejrzaną. Nic nie wysłano. Przeczytaj ją uważnie; może pojawić się nowy szkic.",
  rp_end_policy_changed: "Po utworzeniu szkicu zmieniono ustawienie. Nic nie wysłano.",
  rp_end_draft_changed: "Szkic został zmieniony w programie pocztowym. Wyślij go stamtąd. System nic nie wysłał.",
  rp_end_draft_missing:
    "Szkicu nie ma w folderze Drafts (nie powstał albo został usunięty, przeniesiony lub wysłany w programie pocztowym). System nic nie wysłał.",
  // The Draft reply button of an activity row
  rp_draft_reply: "Szkic odpowiedzi",
  rp_open_draft: "Otwórz szkic",
  rp_draft_reply_for: "Szkic odpowiedzi: {subject}",
  rp_open_draft_for: "Otwórz szkic: {subject}",
} as const;

describe("the Polish texts of the reply panel", () => {
  test("every value is the fixed one", () => {
    for (const [key, value] of Object.entries(PL_TEXTS)) {
      expect(pl[key as keyof typeof pl], key).toBe(value);
    }
    // The table lists every key of the group: a new key needs a row here, and so a review.
    const keys = Object.keys(pl).filter((key) => key.startsWith("rp_"));
    expect(keys.sort()).toEqual(Object.keys(PL_TEXTS).sort());
  });

  test("the register is informal: no formal address, no gendered past tense of the user", () => {
    for (const [key, value] of Object.entries(PL_TEXTS)) {
      expect(value, key).not.toMatch(/\b(Pan|Pani|Państwo|Proszę|Szanown)/);
      expect(value, key).not.toMatch(/(zrobił|napisał|wysłał|odpowiedział)(eś|aś)\b/);
    }
  });

  test("the English and the Polish text hold the same placeholders", () => {
    for (const key of Object.keys(PL_TEXTS)) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(names(pl[key as keyof typeof pl]), key).toEqual(names(en[key as keyof typeof en]));
    }
  });

  test("the instruction counter and the limits name 300 and 10 where the service holds them", () => {
    expect(pl.rp_err_instruction).toContain("300");
    expect(en.rp_err_instruction).toContain("300");
    expect(pl.rp_err_too_many_recipients).toContain("10");
    expect(en.rp_err_too_many_recipients).toContain("10");
  });
});
