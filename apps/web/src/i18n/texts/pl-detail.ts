import type { TextKey } from "../en";

// The Telegram detail level (the link step and the linked card), the owner's lock of it and the notice routes of Settings.
export const plDetail = {
  // The choice of what Telegram gets: the link step and the change dialog
  tgd_title: "Co dostaje Telegram",
  tgd_minimal_option: "Tylko liczby i linki (zalecane)",
  tgd_minimal_text:
    "Telegram dostaje liczbę czekających pozycji i link do panelu. Bez nadawcy, tematu, streszczenia ani szkiców.",
  tgd_full_option: "Pełna treść",
  tgd_full_text:
    "Telegram dostaje nadawcę, temat, streszczenie AI i szkice, z przyciskami „Wyślij”. Telegram przechowuje te komunikaty na swoich serwerach.",
  tgd_locked: "Twoja organizacja dopuszcza tylko liczby i linki.",
  tgd_locked_now:
    "Twoja organizacja ograniczyła Telegram do liczb i linków. Twój wybór (pełna treść) znów zacznie obowiązywać po wyłączeniu blokady.",
  tgd_minimal_short: "Tylko liczby i linki",
  tgd_full_short: "Pełna treść",
  tgd_current_label: "Co teraz dostaje Telegram:",
  tgd_change: "Zmień",
  tgd_change_title: "Zmień, co dostaje Telegram",
  tgd_saved_toast: "Ustawienia Telegrama zapisane.",

  // The owner's lock card of Settings
  tgl_title: "Zakres danych w Telegramie (cała organizacja)",
  tgl_label: "Telegram: dla wszystkich tylko liczby i linki",
  tgl_help:
    "Gdy ta opcja jest włączona, Telegram dostaje tylko liczby i linki, niezależnie od tego, co kto wybrał. Po wyłączeniu blokady każdy znów dostaje to, co sam wybrał.",
  tgl_state_on: "W Twojej organizacji Telegram dostaje dla wszystkich tylko liczby i linki.",
  tgl_state_off: "Każda osoba wybiera sama, co dostaje Telegram.",
  tgl_on_toast: "Telegram dostaje teraz dla wszystkich tylko liczby i linki.",
  tgl_off_toast: "Blokada wyłączona. Każda osoba znów wybiera sama.",

  // The notice routes card of Settings
  nr_title: "Dokąd trafiają komunikaty",
  nr_help:
    "Wybierz Telegram, telefon albo oba kanały dla każdej z trzech grup komunikatów. Podsumowania i raporty nie trafiają na telefon: przychodzą Telegramem albo pocztą, zgodnie z ustawieniem raportów.",
  nr_group_urgent: "Pilna poczta",
  nr_group_approvals: "Zatwierdzenia",
  nr_group_updates: "Aktualizacje",
  nr_telegram: "Telegram",
  nr_phone: "Telefon",
  nr_both: "Oba kanały",
  nr_default: "{value} (domyślnie)",
  nr_none_hint:
    "Nie masz połączonego Telegrama ani urządzenia z powiadomieniami. Połącz Telegram albo włącz powiadomienia na telefonie, żeby dostawać komunikaty.",
  nr_use_default: "Użyj ustawień domyślnych",
  nr_saved_toast: "Ustawienia komunikatów zapisane.",
} satisfies Partial<Record<TextKey, string>>;
