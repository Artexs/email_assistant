import type { TextKey } from "../en";

// The suggestions card of the Rules page (flag sender_suggestions). The panel uses the impersonal past for what the user did
// ("Odpowiedziano", "Oznaczono"), so the reasons follow it and need no gender form.
export const plSuggestions = {
  sg_title: "Sugestie",
  sg_help:
    "Asystent proponuje te reguły na podstawie Twojej poczty. Nic się nie zmieni, dopóki właściciel nie przyjmie sugestii. Odrzucona sugestia jest ukryta przez 90 dni.",
  sg_mailbox_label: "Skrzynka",
  sg_empty: "Brak sugestii. Pojawiają się, gdy poczta wyraźnie na nie wskazuje: najwyżej 3 na skrzynkę w ciągu 7 dni.",
  sg_load_error: "Nie udało się wczytać sugestii.",
  sg_member_note: "Tylko właściciel może przyjąć sugestie.",
  sg_accept: "Przyjmij",
  sg_accept_for: "Przyjmij sugestię dla {pattern}",
  sg_dismiss: "Odrzuć",
  sg_dismiss_for: "Odrzuć sugestię dla {pattern}",
  sg_dismissed_toast: "Sugestia ukryta na 90 dni.",
  sg_not_available: "Ta sugestia nie jest już aktualna.",
  // The reason of a suggestion: counts of the mailbox, never mail text
  sg_reason_vip_answered: "Odpowiedziano na {answered} z {received} wiadomości w ciągu 30 dni.",
  sg_reason_vip_flagged: "Oznaczono flagą {flagged} wiadomości w ciągu 30 dni.",
  sg_reason_whitelist:
    "W ciągu 90 dni przeniesiono ze spamu lub z powiadomień albo poprawiono kategorię {rescued} wiadomości.",
  sg_reason_blocklist:
    "W ciągu 90 dni oznaczono jako spam {corrected} wiadomości od tego nadawcy i w tym czasie nie napisano do niego.",
  sg_reason_whitelist_domain:
    "W ciągu 90 dni przeniesiono ze spamu lub z powiadomień albo poprawiono kategorię {rescued} wiadomości od {senders} nadawców z tej domeny.",
  sg_reason_blocklist_domain:
    "W ciągu 90 dni oznaczono jako spam {corrected} wiadomości od {senders} nadawców z tej domeny i w tym czasie nie napisano do żadnego z nich.",
} satisfies Partial<Record<TextKey, string>>;
