import type { BotTexts } from "./bot";
import type { SendScopeKind, TriageScopeKind } from "./bot-common";
import { pluralCategory } from "./locale";

// The sync interval in the /resume text: the form follows the number (pl: "za minutę", "za 2 minuty", "za 5 minut").

const PL_MINUTES = { one: "minutę", few: "minuty", many: "minut", other: "minut" } as const;

const PL_HELP = [
  "Polecenia:",
  "/digest – podsumowanie teraz",
  "/status – skrzynki, ostatnia synchronizacja, wywołania AI",
  "/pause – wstrzymaj czytanie i klasyfikację Twoich skrzynek",
  "/resume – wznów je",
  "/review – oznacz losową próbkę ostatnich wiadomości",
  "/help – ta lista",
  "Stuknij ✅, gdy kategoria AI jest trafna, albo ✏️, aby ją poprawić.",
  "↩️ pod wierszem podsumowania cofa to, co system zrobił z tą wiadomością (7 dni).",
  "📤 pod zatwierdzeniem wysyła szkic; ✖️ odrzuca go (szkic zostaje usunięty).",
  "✅ Gotowe pod zleceniem z odpowiedzią zamyka je.",
].join("\n");

const PL_TRIAGE: Record<TriageScopeKind, string> = {
  off: "wyłączona",
  synthetic: "tylko wiadomości testowe (TRIAGE_LLM_SCOPE=synthetic)",
  all: "prawdziwe wiadomości z każdej aktywnej skrzynki (TRIAGE_LLM_SCOPE=all)",
};
const PL_ACTIONS: Record<TriageScopeKind, string> = {
  off: "wyłączone",
  synthetic: "tylko wiadomości testowe (ACTIONS_SCOPE=synthetic)",
  all: "prawdziwe wiadomości, według trybu każdej skrzynki (ACTIONS_SCOPE=all)",
};
// A Polish count with its noun: "1 przypomnienie", "2 przypomnienia", "5 przypomnień", "22 przypomnienia".
const PL_REMINDER_NOUN = { one: "przypomnienie", few: "przypomnienia", many: "przypomnień" } as const;
const plReminders = (count: number): string => {
  const category = pluralCategory("pl", count);
  return `${count} ${PL_REMINDER_NOUN[category === "other" ? "many" : category]}`;
};

const PL_SEND: Record<SendScopeKind, string> = {
  off: "wyłączone",
  self: "tylko na Twoje adresy testowe (SEND_SCOPE=self)",
  all: "prawdziwi odbiorcy, po stuknięciu właściciela (SEND_SCOPE=all)",
};

export const botPl: BotTexts = {
  help: PL_HELP,
  linked: `✅ Ten czat jest połączony. Tu przychodzą podsumowania i pilne komunikaty.\n${PL_HELP}`,
  alreadyLinked: `✅ Ten czat jest już połączony.\n${PL_HELP}`,
  linkUsed: "Ten link został już użyty. Poproś o nowy link.",
  linkExpired: "Ten link wygasł (link działa 15 minut). Poproś o nowy link.",
  error: "Coś poszło nie tak. Spróbuj ponownie później.",
  accountPaused: (operatorContact) => {
    const base = "⏸ To konto jest wstrzymane. Teraz nic się nie zmienia. Aby je wznowić, skontaktuj się z";
    return operatorContact === null ? `${base} operatorem.` : `${base}: ${operatorContact}.`;
  },
  commands: {
    digest: "Podsumowanie teraz",
    status: "Skrzynki, ostatnia synchronizacja, wywołania AI",
    pause: "Wstrzymaj czytanie i klasyfikację",
    resume: "Wznów czytanie i klasyfikację",
    review: "Oznacz próbkę ostatnich wiadomości",
    help: "Lista poleceń",
  },
  status: {
    title: (day, time) => `📊 Stan · ${day} ${time}`,
    noMailbox: "Brak połączonej skrzynki.",
    modes: { shadow: "podgląd", assist: "asystent" },
    modeNone: "brak (skrzynka bez ustawień, bez klasyfikacji)",
    mailboxLine: (mode, state) => `Tryb: ${mode}, ${state}`,
    stateActive: "aktywna",
    statePaused: (since) => `wstrzymana od ${since}`,
    stateAuthError: (since) => `błąd logowania od ${since} (uruchom mailbox:password)`,
    stateAuthErrorOAuth: (since) => `błąd logowania od ${since} (połącz ponownie w panelu)`,
    stateHostBlocked: (since) => `serwer poczty niedozwolony od ${since} (sprawdzany przy każdej synchronizacji)`,
    lastSync: (when, late) =>
      `Ostatnia synchronizacja: ${when === null ? "nigdy" : `${when}${late ? " (spóźniona)" : ""}`}`,
    llmCalls: (since, calls, cap) => `Wywołania AI od ${since}: ${calls} z ${cap}`,
    waiting: (count) => `Czeka na klasyfikację: ${count}`,
    triage: (scope) => `Klasyfikacja: ${PL_TRIAGE[scope]}`,
    actions: (scope, counts) =>
      `Działania: ${PL_ACTIONS[scope]}; ostatnie 24 h wykonano ${counts.applied}, cofnięto ${counts.undone}, z błędem ${counts.failed}`,
    approvals: "Zatwierdzenia",
    approvalsOf: (address) => `Zatwierdzenia ${address}`,
    approvalsLine: (label, waiting, extra) =>
      `${label}: ${waiting} do Twojego stuknięcia${extra.oldest === null ? "" : ` (najstarsze z ${extra.oldest})`}${extra.held === null ? "" : ` · ${extra.held}`}`,
    approvedPaused: (count) => `zatwierdzono ${count}, wysyłka czeka, bo skrzynka jest wstrzymana`,
    approvedAuthError: (count) => `zatwierdzono ${count}, wysyłka czeka, bo logowanie do skrzynki nie działa`,
    approvedHostBlocked: (count) => `zatwierdzono ${count}, wysyłka czeka, bo serwer poczty jest niedozwolony`,
    approvedHeld: (count, scope) => `zatwierdzono ${count}, wysyłka wstrzymana przez SEND_SCOPE=${scope}`,
    approvedSending: (count) => `zatwierdzono ${count}, trwa wysyłanie`,
    send: (scope) => `Wysyłanie: ${PL_SEND[scope]}`,
    delegations: (open, overdue) => `Zlecenia: ${open} bez odpowiedzi, ${overdue} po terminie`,
    llm: (provider, model) => `Model AI: ${provider} · ${model}`,
    noDigestTimes: "Brak godzin podsumowań (bun run digest:times)",
    nextDigest: (time) => `Następne podsumowanie: ${time}`,
    quietHours: (start, end) => `Godziny ciszy: ${start}–${end} (komunikaty czekają do ${end})`,
    noQuietHours: "Godziny ciszy: brak (komunikaty przychodzą o każdej porze)",
  },
  switch: {
    ownerOnly: "Tylko właściciel może wstrzymać lub wznowić skrzynki.",
    alreadyPaused: (address) => `${address}: już wstrzymana.`,
    alreadyActive: (address) => `${address}: już aktywna.`,
    loginError: (address) => `❌ ${address}: błąd logowania. Najpierw uruchom mailbox:password.`,
    loginErrorOAuth: (address) => `❌ ${address} ma błąd logowania: najpierw stuknij „Połącz ponownie” w panelu.`,
    hostBlocked: (address) =>
      `⛔ ${address}: serwer poczty jest niedozwolony; system sprawdza go przy każdej synchronizacji.`,
    pausedHeader: (list) => `⏸ Wstrzymano: ${list}`,
    pausedExplain:
      "System nie czyta ani nie klasyfikuje tych skrzynek i nie wysyła o nich pilnych komunikatów. Podsumowania nadal przychodzą.",
    pausedResume: "/resume wznawia je.",
    resumedHeader: (list) => `▶️ Wznowiono: ${list}`,
    resumedExplain: (minutes) =>
      `Następna synchronizacja ruszy najpóźniej za ${minutes} ${PL_MINUTES[pluralCategory("pl", minutes)]}. Wiadomości z czasu wstrzymania zostaną wtedy odczytane; wiadomości starsze niż 7 dni nie są klasyfikowane.`,
    noMailbox: "Brak połączonej skrzynki.",
  },
  taps: {
    invalid: "Ten przycisk już nie działa.",
    cancelled: "✏️ Anulowano.",
    picker: {
      title: (subject, aiCategory) => `✏️ Wybierz właściwą kategorię\n${subject}\nPropozycja AI: ${aiCategory}`,
      cancelButton: "✖️ Anuluj",
    },
    ownerOnly: "Tylko właściciel może zatwierdzić lub odrzucić wysyłkę.",
    approved: "⏳ Wysyłanie w ciągu minuty.",
    approvedHeld: "Zatwierdzono. Wysyłanie jest wstrzymane przez SEND_SCOPE na serwerze; /status pokazuje szczegóły.",
    approvedPaused: "Zatwierdzono. Skrzynka jest wstrzymana, więc wysyłka czeka; /status pokazuje szczegóły.",
    approvedAuthError:
      "Zatwierdzono. Logowanie do skrzynki nie działa, więc wysyłka czeka, aż hasło zostanie poprawione; /status pokazuje szczegóły.",
    approvedHostBlocked:
      "Zatwierdzono. Serwer poczty tej skrzynki jest niedozwolony, więc wysyłka czeka; /status pokazuje szczegóły.",
    alreadyApproved: (clock) => `Już zatwierdzono (${clock}).`,
    sending: "Już zatwierdzono, trwa wysyłanie.",
    sent: "Już wysłano.",
    rejected: "Ta wysyłka została odrzucona.",
    expired: "To zatwierdzenie wygasło. Wiadomość nie została wysłana.",
    failed: "Ta wysyłka nie powiodła się. Zobacz komunikat z wynikiem.",
    draftNotReady: "Szkicu nie ma jeszcze w folderze Drafts. Stuknij ponownie za minutę.",
    hasGaps: "W tym szkicu jest jeszcze luka ([[…]]). Najpierw uzupełnij ją w panelu. Nic nie wysłano.",
    featureOff: "Szkice odpowiedzi są wyłączone. Nic nie wysłano.",
    rejectedNow: "✖️ Odrzucono. Szkic zostanie usunięty.",
    notFound: "Tej wiadomości nie ma na Twoim koncie.",
    changed: "Ten szkic został zmieniony. Użyj najnowszej wiadomości.",
    sendAgain: "⏳ Zatwierdzono nową wysyłkę. Wysyłanie w ciągu minuty.",
    sendAgainHeld: {
      scope:
        "Zatwierdzono nową wysyłkę. Wysyłanie jest wstrzymane przez SEND_SCOPE na serwerze; /status pokazuje szczegóły.",
      paused: "Zatwierdzono nową wysyłkę. Skrzynka jest wstrzymana, więc wysyłka czeka; /status pokazuje szczegóły.",
      auth_error:
        "Zatwierdzono nową wysyłkę. Logowanie do skrzynki nie działa, więc wysyłka czeka; /status pokazuje szczegóły.",
      host_blocked:
        "Zatwierdzono nową wysyłkę. Serwer poczty jest niedozwolony, więc wysyłka czeka; /status pokazuje szczegóły.",
    },
    heldNotes: {
      scope: "Wysyłanie jest wstrzymane przez SEND_SCOPE na serwerze",
      paused: "Skrzynka jest wstrzymana, więc wysyłki czekają",
      auth_error: "Logowanie do skrzynki nie działa, więc wysyłki czekają",
      host_blocked: "Serwer poczty jest niedozwolony, więc wysyłki czekają",
    },
    sendAgainAlready: "Ponowna wysyłka tej wiadomości została już zatwierdzona.",
    sendAgainNotFailed: "Ta wysyłka nie zakończyła się błędem.",
    sendAgainDraftGone: "Szkicu już nie ma: wiadomość trzeba sklasyfikować ponownie.",
    sendAgainDelegationClosed: "Zlecenie jest zamknięte: bez ponownej wysyłki.",
    setNothing: "Nie ma co zatwierdzać: przypomnienia zostały już obsłużone.",
    setApproved: (approved, skipped) => {
      const category = pluralCategory("pl", approved);
      const out = { one: "wyjdzie", few: "wyjdą", many: "wyjdzie", other: "wyjdzie" }[category];
      return `⏳ ${plReminders(approved)} ${out} w ciągu minuty (pominięto ${skipped}).`;
    },
    setApprovedHeld: (approved, skipped, note) =>
      `⏳ Zatwierdzono ${plReminders(approved)} (pominięto ${skipped}). ${note}; /status pokazuje szczegóły.`,
    setRejected: (count) => `✖️ Pominięto ${plReminders(count)}.`,
    done: "✅ Gotowe.",
    doneAlready: "Już gotowe.",
    doneNotClosable: "To zlecenie nie ma jeszcze odpowiedzi.",
    wentOut: "✅ Zlecenie oznaczono jako wysłane. Odpowiedź wykonawcy zostanie teraz dopasowana.",
    wentOutAlready: "Już oznaczono jako wysłane.",
    wentOutSentAgain: "Wiadomość wysłano ponownie: bez zmian.",
    wentOutNotUnknown: "Ta wysyłka nie jest w stanie nieznanym: bez zmian.",
    wentOutDelegationNotOpen: "Zlecenie nie czeka już na tę odpowiedź: bez zmian.",
    reply: {
      drafting: "✍️ Piszę szkic. Przyjdzie w nowej wiadomości.",
      redraftAsk: "Napisz jedną linijkę w odpowiedzi na wiadomość poniżej.",
      redraftQueued: "✍️ Piszę nową wersję. Przyjdzie w nowej wiadomości.",
      redraftLimit: "Ten szkic ma już 5 nowych wersji. Edytuj go w panelu.",
      instructionLength: "Napisz jedną linijkę, od 1 do 300 znaków.",
      closed: "Ten szkic jest zamknięty. Nic się nie zmieniło.",
      recipientsDone: "👥 Zmieniono odbiorców. Nowa wersja przyjdzie w nowej wiadomości.",
      tooManyRecipients: "Zbyt wielu odbiorców: odpowiedź może trafić najwyżej do 10 dodatkowych osób. Użyj panelu.",
      noReplyTo: "Ta wiadomość nie ma innego adresu Reply-To.",
      noOthers: "Ta wiadomość nie ma innych odbiorców.",
      badRecipient: "Nie można użyć jednego z adresów tej wiadomości. Zmień odbiorców w panelu.",
      recipientsUnchanged: "Szkic już trafia do tych odbiorców.",
      blocked: {
        not_checked: "Ta wiadomość nie została jeszcze sprawdzona. Spróbuj za kilka minut.",
        category: "Ta wiadomość nie wymaga odpowiedzi.",
        junk_source: "Ta wiadomość pochodzi z folderu spam. Brak szkicu.",
        not_a_person: "Ta wiadomość jest automatyczna albo z listy mailingowej. Brak szkicu.",
        own_mailbox: "Ta wiadomość pochodzi z Twojej własnej skrzynki. Brak szkicu.",
        suspicious: "Ta wiadomość wygląda podejrzanie. Brak szkicu.",
        calendar: "To zaproszenie z kalendarza. Odpowiedz na nie w kalendarzu.",
        answered: "Ta wiadomość ma już odpowiedź.",
        too_old: "Ta wiadomość jest za stara na szkic.",
        language: "Nie można ustalić języka tej wiadomości. Brak szkicu.",
        open_newer: "Nowsza wiadomość w tym wątku ma już szkic.",
        oauth_mailbox: "Szkice odpowiedzi nie działają jeszcze dla tego typu skrzynki.",
        policy_changed: "Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w panelu.",
      },
    },
  },
};
