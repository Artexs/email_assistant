import { describe, expect, test } from "bun:test";

import { en, enPlurals } from "./en";
import { setLocaleForTest, tp } from "./index";
import { pl, plPlurals } from "./pl";

// The texts of the "Open loops" page have a fixed Polish value. A reword changes this table on purpose; the review
// of the Polish text reads it here. The words follow the glossary: "zlecenie", "otwarte sprawy", "przypomnienie o odpowiedzi"; no text
// speaks of the user in a gendered past tense.
const PL_TEXTS = {
  nav_open_loops: "Otwarte sprawy",
  title_open_loops: "Otwarte sprawy",
  lp_tabs_label: "Rodzaje otwartych spraw",
  lp_tab_delegated: "Zlecone",
  lp_tab_waiting: "Czekam",
  lp_tab_promised: "Obiecane",
  lp_filters_label: "Filtr otwartych spraw",
  lp_filter_due: "Na dziś",
  lp_list_delegated: "Z Twojej wysłanej poczty",
  lp_list_waiting: "Oczekiwanie na odpowiedź",
  lp_list_promised: "Twoje obietnice",
  lp_empty_open: "Nie ma tu otwartych spraw.",
  lp_empty_due: "Na dziś nic nie ma.",
  lp_empty_closed: "Nie ma tu zamkniętych spraw.",
  lp_load_error: "Nie udało się wczytać otwartych spraw.",
  lp_more_error: "Nie udało się wczytać kolejnych spraw.",
  lp_owner_only:
    "Tylko właściciel może przygotowywać przypomnienia, porzucać sprawy, przestawać je śledzić i otwierać je ponownie.",
  lp_status_open: "Otwarta",
  lp_status_closed: "Zamknięta",
  lp_no_text: "Treść tej sprawy nie jest już zapisana.",
  lp_unnamed: "ta sprawa",
  lp_reason_asked: "Pytanie bez odpowiedzi. Czas oczekiwania: {days}.",
  lp_reason_forwarded: "Sprawa zlecona dalej, bez odpowiedzi. Czas oczekiwania: {days}.",
  lp_reason_promised: "Obiecano to w wysłanej wiadomości.",
  lp_days_less: "mniej niż jeden dzień roboczy",
  lp_due_stated: "Termin: {date} (podany w wiadomości)",
  lp_due_default: "Termin: {date} (domyślny)",
  lp_follow_ups: "Przypomnienia o odpowiedzi: {n} z {max}",
  lp_matched_subject: "Dopasowano po temacie: odpowiedź przyszła w innym wątku.",
  lp_auto_reply_only: "Tylko automatyczna odpowiedź: sprawa zostaje otwarta.",
  lp_closed_replied: "Zamknięte: nadeszła odpowiedź.",
  lp_closed_replied_subject: "Zamknięte: odpowiedź nadeszła w innym wątku.",
  lp_closed_done: "Zamknięte: oznaczono jako gotowe.",
  lp_closed_dropped: "Zamknięte: porzucono.",
  lp_closed_untracked: "Zamknięte: sprawa nie jest już śledzona.",
  lp_closed_stale: "Zamknięte: brak odpowiedzi po przypomnieniach.",
  lp_closed_later_reply: "Zamknięte: napisano do tej osoby ponownie.",
  lp_closed_expired: "Zamknięte: minął termin obietnicy.",
  lp_closed_sent_off: "Zamknięte: śledzenie wysłanej poczty zostało wyłączone.",
  lp_follow_up: "Przygotuj przypomnienie",
  lp_follow_up_for: "Przygotuj przypomnienie: {name}",
  lp_later: "Później",
  lp_later_for: "Później: {name}",
  lp_done: "Gotowe",
  lp_done_for: "Gotowe: {name}",
  lp_drop: "Porzuć",
  lp_drop_for: "Porzuć: {name}",
  lp_untrack: "Przestań śledzić",
  lp_untrack_for: "Przestań śledzić: {name}",
  lp_reopen: "Otwórz ponownie",
  lp_reopen_for: "Otwórz ponownie: {name}",
  lp_follow_up_waits: "Przypomnienie czeka na Twoje zatwierdzenie.",
  lp_follow_up_link: "Otwórz przypomnienie",
  lp_ok_follow_up: "Przypomnienie przygotowane. Zatwierdź je, aby je wysłać.",
  lp_ok_would_draft: "Tryb podglądu: bez szkicu.",
  lp_ok_later: "Przesunięto na {date}.",
  lp_ok_done: "Oznaczono jako gotowe.",
  lp_ok_drop: "Porzucono.",
  lp_ok_untrack: "Przestano śledzić.",
  lp_ok_reopen: "Otwarto ponownie.",
  lp_gone: "Tej sprawy już nie ma.",
  lp_moved: "Ta sprawa zmieniła stan i nie jest już na tej karcie.",
  lp_c_waiting: "Przypomnienie już czeka na Twoje zatwierdzenie.",
  lp_c_closed: "Ta sprawa jest zamknięta.",
  lp_c_follow_up_limit: "Dwa przypomnienia już przygotowano: więcej nie będzie.",
  lp_c_too_soon: "Na kolejne przypomnienie jest jeszcze za wcześnie. Poczekaj 3 dni robocze od poprzedniego.",
  lp_c_suspicious: "Ten wątek wygląda podejrzanie: bez przypomnienia.",
  lp_c_drafts_off: "Przypomnienia wymagają trybu asystenta z włączonymi szkicami.",
  lp_c_promised_follow_up: "Obietnica nie ma przypomnienia.",
  lp_c_later_limit: "Tę sprawę przesunięto już 3 razy.",
  lp_c_promised_later: "Obietnicy nie można przesunąć.",
  lp_c_already_closed: "Ta sprawa jest już zamknięta.",
  lp_c_already_open: "Ta sprawa jest już otwarta.",
  lp_c_untrack_not_allowed: "Przestać śledzić można tylko sprawę zleconą dalej.",
  lp_c_reopen_not_allowed: "Tej sprawy nie można otworzyć ponownie: śledzenie wysłanej poczty jest wyłączone.",
  lp_drop_title: "Porzucić tę sprawę?",
  lp_drop_text: "{name}. Nic nie zostanie wysłane. Możesz ją otworzyć ponownie w filtrze Zamknięte.",
  lp_drop_confirm: "Porzuć",
  lp_untrack_title: "Przestać śledzić tę sprawę?",
  lp_untrack_text:
    "{name}. Zlecenie zostaje bez zmian. Panel przestaje śledzić tę sprawę. Możesz ją otworzyć ponownie w filtrze Zamknięte.",
  lp_untrack_confirm: "Przestań śledzić",
  lp_keep: "Zachowaj",
} as const;

const NEW_KEYS = (Object.keys(en) as (keyof typeof en)[]).filter(
  (key) => key.startsWith("lp_") || key === "nav_open_loops" || key === "title_open_loops"
);

describe("the open loops page texts", () => {
  test("the table holds every new key and no other", () => {
    expect(Object.keys(PL_TEXTS).sort()).toEqual([...NEW_KEYS].sort());
  });

  test("each new key has the fixed Polish value", () => {
    for (const key of NEW_KEYS) expect([key, pl[key]]).toEqual([key, (PL_TEXTS as Record<string, string>)[key]]);
  });

  test("no Polish text is gendered about the user, and none says delegacja", () => {
    for (const key of NEW_KEYS) {
      expect([key, /(łeś|łaś)(?!\p{L})/u.test(pl[key])]).toEqual([key, false]);
      expect(pl[key].toLowerCase()).not.toContain("delegacj");
    }
  });

  test("the wait is counted in the forms of each language", () => {
    expect(enPlurals.lp_working_days).toEqual({ one: "1 working day", other: "{count} working days" });
    expect(plPlurals.lp_working_days).toEqual({
      one: "1 dzień roboczy",
      few: "{count} dni robocze",
      many: "{count} dni roboczych",
    });
    setLocaleForTest("pl");
    expect([
      tp("lp_working_days", 1),
      tp("lp_working_days", 2),
      tp("lp_working_days", 5),
      tp("lp_working_days", 22),
    ]).toEqual(["1 dzień roboczy", "2 dni robocze", "5 dni roboczych", "22 dni robocze"]);
    setLocaleForTest("en");
  });
});
