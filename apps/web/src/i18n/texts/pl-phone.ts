import type { TextKey } from "../en";

// The phone channel: the offline page of the installed panel and the push device card.
export const plPhone = {
  offline_title: "Brak połączenia",
  offline_text: "Panel potrzebuje połączenia z siecią, żeby pokazać Twoje dane. Sprawdź połączenie i spróbuj ponownie.",
  offline_retry: "Spróbuj ponownie",

  // The push device card of Settings
  push_title: "Powiadomienia na telefonie",
  push_help:
    "Dostaniesz krótkie powiadomienie na to urządzenie, gdy coś wymaga Twojej uwagi. Pokazuje rodzaj i liczbę, nigdy treści maila. Powiadomienia ustają, gdy kończy się Twoje logowanie: otwórz panel ponownie, żeby wróciły.",
  push_not_set_up: "Powiadomienia na telefonie nie są skonfigurowane na tym serwerze",
  push_unsupported: "Ta przeglądarka nie pokazuje powiadomień na telefonie.",
  push_devices_title: "Urządzenia z powiadomieniami",
  push_no_devices: "Żadne urządzenie nie ma jeszcze włączonych powiadomień.",
  push_added: "Dodano {date}",
  push_last: "Ostatnie powiadomienie {date}",
  push_never: "Jeszcze nic nie dostarczono",
  push_enable: "Włącz powiadomienia na tym urządzeniu",
  push_enabled_toast: "Powiadomienia są włączone na tym urządzeniu.",
  push_blocked: "Powiadomienia są zablokowane w ustawieniach przeglądarki",
  push_enable_failed: "Nie udało się włączyć powiadomień na tym urządzeniu. Spróbuj ponownie.",
  push_test: "Wyślij powiadomienie testowe",
  push_test_none: "Nic nie wysłano. Najpierw włącz powiadomienia na tym urządzeniu.",
  push_test_limit: "Za dużo powiadomień testowych. Spróbuj ponownie za godzinę.",
  push_load_error: "Nie udało się wczytać urządzeń.",
  push_remove_short: "Usuń",
  push_remove: "Usuń {label}",
  push_remove_title: "Usunąć to urządzenie?",
  push_remove_text: "Nie dostanie już powiadomień. Możesz włączyć je ponownie na tym urządzeniu.",
  push_remove_confirm: "Usuń urządzenie",
  push_removed_toast: "Urządzenie usunięte.",
  push_install: "Zainstaluj aplikację",
  push_install_ios:
    "Udostępnij → Dodaj do ekranu głównego, potem otwórz aplikację i włącz tutaj powiadomienia (iOS 16.4 lub nowszy).",
} satisfies Partial<Record<TextKey, string>>;
