import { pluralCategory } from "./locale";
import type { NoticeTexts } from "./notices";

const PL_TIMES = { one: "raz", few: "razy", many: "razy", other: "razy" } as const;

const PL_WAITING = {
  one: (count: number) => `${count} wiadomość czeka`,
  few: (count: number) => `${count} wiadomości czekają`,
  many: (count: number) => `${count} wiadomości czeka`,
  other: (count: number) => `${count} wiadomości czeka`,
} as const;

const PL_REPLIES_READY = {
  one: (count: number) => `Gotowy jest ${count} szkic odpowiedzi`,
  few: (count: number) => `Gotowe są ${count} szkice odpowiedzi`,
  many: (count: number) => `Gotowych jest ${count} szkiców odpowiedzi`,
  other: (count: number) => `Gotowych jest ${count} szkiców odpowiedzi`,
} as const;

const PL_NOTICES = { one: "powiadomienie", few: "powiadomienia", many: "powiadomień", other: "powiadomień" } as const;

const PL_OPEN = { one: "otwarte", few: "otwarte", many: "otwartych", other: "otwartych" } as const;

const PL_CALLS = { one: "wywołanie", few: "wywołania", many: "wywołań", other: "wywołań" } as const;

// After "z" and a count the noun is genitive plural, except after 1.
const PL_LABELS = { one: "etykiety", few: "etykiet", many: "etykiet", other: "etykiet" } as const;

const PL_MISSED = { one: "pominięta", few: "pominięte", many: "pominiętych", other: "pominiętych" } as const;

// Polish writes a decimal with a comma.
const plDecimal = (value: number | string): string => String(value).replace(".", ",");

const PL_REVIEW = {
  one: (count: number) => `${count} wiadomość z odpowiedzią czeka`,
  few: (count: number) => `${count} wiadomości z odpowiedzią czekają`,
  many: (count: number) => `${count} wiadomości z odpowiedzią czeka`,
  other: (count: number) => `${count} wiadomości z odpowiedzią czeka`,
} as const;

export const noticesPl: NoticeTexts = {
  urgentTitle: "🔴 Pilna wiadomość",
  received: (clock) => `Odebrano ${clock}`,
  authError: {
    first: (address, since) => `❌ Nie udało się zalogować do skrzynki: ${address}. Błąd trwa od ${since}.`,
    noRead: "System nie czyta teraz tej skrzynki. Żadna wiadomość nie ginie: zostaje na serwerze poczty.",
    fix: (mailboxId) =>
      `Aby to naprawić, sprawdź hasło i uruchom mailbox:password dla skrzynki ${mailboxId} (instrukcja: deploy/README.md).`,
    fixOAuth: (provider, reason) => {
      switch (reason) {
        case "oauth_expired":
          return `Logowanie do ${provider} wygasło. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.`;
        case "oauth_revoked":
          return `Dostęp do skrzynki cofnięto po stronie ${provider}. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.`;
        case "admin_consent_required":
          return `Ta aplikacja wymaga zatwierdzenia w usłudze ${provider}: przez Ciebie lub przez Twojego administratora. Otwórz panel, Skrzynki: stuknij „Połącz ponownie” albo użyj tam linku do zatwierdzenia.`;
        case "protocol_disabled":
          return "Administrator wyłączył IMAP lub SMTP dla tej skrzynki. Poproś o włączenie, potem stuknij „Połącz ponownie” w panelu.";
        case null:
          return `Logowanie do ${provider} nie działa. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.`;
      }
    },
  },
  hostBlocked: {
    first: (address, since) => `⛔ System przestał łączyć się z serwerem poczty skrzynki ${address} (od ${since}).`,
    why: "Nazwa serwera wskazuje adres w sieci prywatnej lub lokalnej, a system nigdy się z takim nie łączy.",
    noRead:
      "System nie czyta teraz tej skrzynki i nie wysyła z niej poczty. Żadna wiadomość nie ginie, bo zostaje na serwerze poczty.",
    recheck:
      "System sprawdza serwer przy każdej synchronizacji i sam uruchomi skrzynkę ponownie. /status pokazuje stan.",
  },
  sentMissing: {
    first: (address, since) => `📭 Brak wysłanej poczty dla ${address} od ${since}.`,
    ask: "Czy Twój program pocztowy zapisuje kopię w folderze Wysłane? Asystent potrzebuje jej, żeby wiedzieć, na co czekasz.",
  },
  syncStale: {
    first: (address) => `⚠️ Synchronizacja poczty jest opóźniona: ${address}.`,
    last: (last) => `Ostatnia udana synchronizacja: ${last}. System dalej próbuje.`,
    status: "/status pokazuje stan.",
    never: "nigdy",
  },
  syncOk: (address, last) => `✅ Synchronizacja poczty znów działa: ${address}. Ostatnia synchronizacja ${last}.`,
  actionFailed: {
    first: {
      move: {
        original: "Nie udało się przenieść wiadomości",
        reverse: "Cofnięcie nie powiodło się. Nie udało się przenieść wiadomości z powrotem do folderu:",
      },
      flag: {
        original: "Nie udało się oznaczyć wiadomości",
        reverse: "Cofnięcie nie powiodło się: nie udało się zdjąć oznaczenia",
      },
      mark_read: {
        original: "Nie udało się oznaczyć wiadomości jako przeczytanej",
        reverse: "Cofnięcie nie powiodło się: nie udało się oznaczyć wiadomości jako nieprzeczytanej",
      },
      create_draft: {
        original: "Nie udało się utworzyć szkicu",
        reverse: "Nie udało się usunąć szkicu dla wiadomości",
      },
    },
    toFolder: (folder) => ` do folderu: ${folder}`,
    tried: (count) => `Próbowano ${count} ${PL_TIMES[pluralCategory("pl", count)]}.`,
    notFound: "Nie znaleziono wiadomości: ktoś przeniósł ją lub usunął w programie pocztowym.",
    badPayload: (folder) => `Plan wskazywał nieznany folder. Wiadomość zostaje w folderze: ${folder}.`,
    staysIn: (folder) => `Wiadomość zostaje w folderze: ${folder}.`,
    staysInAiFolder: (folder) =>
      folder === null
        ? "Wiadomość zostaje w swoim folderze AI. Przenieś ją ręcznie."
        : `Wiadomość zostaje w folderze: ${folder}. Przenieś ją ręcznie.`,
    draftStays: "Szkic zostaje w folderze Drafts: usuń go ręcznie.",
    status: "/status pokazuje stan skrzynki.",
  },
  mailboxRemoved: "Skrzynka usunięta. Zmień teraz jej hasło w ustawieniach dostawcy poczty.",
  mailboxRemovedAccess: {
    googleRevoked: "Skrzynka usunięta. Dostęp przez Google został cofnięty.",
    googleFailed: "Skrzynka usunięta. Cofnij teraz dostęp na myaccount.google.com/permissions.",
    microsoftWork: "Skrzynka usunięta. Cofnij teraz dostęp aplikacji na myapps.microsoft.com.",
    microsoftPersonal: "Skrzynka usunięta. Cofnij teraz dostęp aplikacji na account.live.com/consent/Manage.",
  },
  notTriaged: (sender) =>
    `📭 Wiadomość od ${sender} nie jest jeszcze posortowana: usługa AI ma przerwę. Zostanie posortowana, gdy usługa wróci.`,
  followUp: {
    failed: "⚠️ Nie udało się wysłać przypomnienia o odpowiedzi. Nic nie wyszło.",
    unknown:
      "⚠️ Przypomnienie o odpowiedzi mogło wyjść: połączenie przerwało się po wysłaniu treści. Sprawdź folder Sent, zanim napiszesz kolejne.",
    held: (limit) => `⏸ Przypomnienie o odpowiedzi czeka: ${limit}.`,
  },
  loopConsent: {
    approval: "Przypomnienie o odpowiedzi czeka na Twoje zatwierdzenie w panelu.",
    result: "Przypomnienie o odpowiedzi ma nowy status. Sprawdź go w panelu.",
  },
  replyDrafts: {
    ready: (count, clock) => `✍️ ${PL_REPLIES_READY[pluralCategory("pl", count)](count)} (${clock}).`,
    prompt: "✍️ Napisz jedną linijkę: co ma być w odpowiedzi?",
    results: {
      needs_facts: "✍️ Brak szkicu: odpowiedź wymaga faktów, których nie ma w wiadomości. Napisz ją samodzielnie.",
      not_a_reply: "✍️ Brak szkicu: ta wiadomość nie wymaga odpowiedzi.",
      unsafe_request: "✍️ Brak szkicu: ta wiadomość prosi o coś, co wymaga Twojej własnej decyzji.",
      no_text: "✍️ Brak szkicu: treść wiadomości nie jest już zapisana.",
      timeout: "✍️ Szkic powstawał za długo. Spróbuj jeszcze raz.",
      llm_cap: "✍️ Dzienny limit wywołań AI dla tej skrzynki został wykorzystany. Spróbuj jutro.",
      llm_error: "✍️ Usługa AI zawiodła. Spróbuj później.",
      checks: "✍️ Szkic nie przeszedł kontroli bezpieczeństwa. Spróbuj ponownie albo napisz odpowiedź samodzielnie.",
      output: "✍️ AI nie dało użytecznej odpowiedzi. Spróbuj ponownie.",
      internal: "✍️ Coś poszło nie tak. Spróbuj później.",
      closed: "✍️ Ten szkic został zamknięty; nic się nie zmieniło.",
      changed: "✍️ W międzyczasie inna wersja zastąpiła ten szkic. Użyj najnowszej wiadomości.",
      off: "✍️ Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w panelu.",
      mail_gone: "✍️ Wiadomość nie jest już dostępna.",
      generic: "✍️ Nie powstał żaden szkic.",
    },
    review: "📝 Przejrzyj",
    consent: "Potwierdź nowe warunki Telegrama w panelu, aby przeglądać szkice tutaj.",
    draft: "✍️ Szkic odpowiedzi",
    draftRow: (n) => `✍️ ${n}`,
  },
  trustReady: {
    first: (checked) => `📋 Sprawdzanie poczty z ostatnich 30 dni zakończone. Przejrzane wiadomości: ${checked}.`,
    recommended: (categories) => `Polecane do włączenia: ${categories}`,
    none: "Na razie nie ma nic do włączenia.",
    link: (url) => `Raport: ${url}`,
  },
  autonomyPaused: {
    corrections: (category, count) =>
      `⏸ Automatyczne przenoszenie wiadomości z kategorii „${category}” zostało wstrzymane: w ciągu 7 dni poprawiono ${count} z tych przeniesień.`,
    importantHidden: (category) =>
      `⏸ Automatyczne przenoszenie wiadomości z kategorii „${category}” zostało wstrzymane: jedno z przeniesień ukryło wiadomość, która była Ci potrzebna.`,
    modelSwitch: (category) =>
      `⏸ Automatyczne przenoszenie wiadomości z kategorii „${category}” zostało wstrzymane: zmienił się model AI, a nowy model nie ma jeszcze potwierdzonych wyników dla tej kategorii.`,
    evidenceChanged: (category) =>
      `⏸ Automatyczne przenoszenie wiadomości z kategorii „${category}” zostało wstrzymane: nowe wyniki testów już go nie uzasadniają.`,
    historyFail: (category) =>
      `⏸ Automatyczne przenoszenie wiadomości z kategorii „${category}” zostało wstrzymane: sprawdzenie poczty z ostatnich 30 dni wykryło wśród przeniesionych wiadomości takie, które były Ci potrzebne.`,
    again: "Włącz je ponownie w Ustawieniach.",
    link: (url) => `Ustawienia: ${url}`,
  },
  sendHeld: {
    first: (address, limit) => `⏸ Wysyłanie czeka (skrzynka ${address}): ${limit}.`,
    limit: {
      mailbox_hour: "osiągnięto godzinny limit wysyłania z tej skrzynki",
      mailbox_day: "osiągnięto dzienny limit wysyłania z tej skrzynki",
      recipient_day: "osiągnięto dzienny limit dla jednego odbiorcy",
    },
    waiting: (count, clock) => `${PL_WAITING[pluralCategory("pl", count)](count)}; następna wyjdzie około ${clock}.`,
  },
  weekly: {
    title: (from, to) => `📈 Tydzień ${from} – ${to}`,
    noMail: "W tym tygodniu nie było poczty.",
    missed: (rate) => `Pominięta ważna poczta (dolna granica): ${rate}`,
    sample: (missed, important) =>
      `Losowa próba z /review: ${missed} ${PL_MISSED[pluralCategory("pl", missed)]} z ${important}`,
    loopsClosed: (percent, counts) => `${percent} zamkniętych ${counts}`,
    loopsSurfaced: (percent, counts) => `${percent} zgłoszonych Ci ${counts}`,
    loops: (closed, surfaced, pending) =>
      `Zlecenia w terminie: ${closed}, ${surfaced}${pending > 0 ? `, ${pending} nadal ${PL_OPEN[pluralCategory("pl", pending)]}` : ""}`,
    loopsOf: (closed, surfaced) => `W tym otwarte sprawy: ${closed}, ${surfaced}`,
    loopsNone: (pending) =>
      `Zlecenia w terminie: żadne nie miało terminu${pending > 0 ? `, ${pending} nadal ${PL_OPEN[pluralCategory("pl", pending)]}` : ""}`,
    mistakes: {
      total: (count) => `Poważne błędy: ${count}`,
      hiddenImportant: (count) => `ukryta ważna wiadomość ${count}`,
      wrongPerson: (count) => `zła osoba ${count}`,
      wrongContent: (count) => `zła treść ${count}`,
      sentByMistake: (count) => `wysłano przez pomyłkę ${count}`,
    },
    handled: (rate) => `Załatwione za Ciebie: ${rate}`,
    wouldHandle: (rate) => `Załatwiłbym (tryb podglądu): ${rate}`,
    urgent: (p90, noticed, withoutNotice) =>
      `Czas powiadomienia o pilnej poczcie: p90 ${p90 === null ? "–" : `${plDecimal(p90)} min`} (${noticed} ${PL_NOTICES[pluralCategory("pl", noticed)]}${withoutNotice > 0 ? `, ${withoutNotice} bez powiadomienia` : ""})`,
    urgentNone: "Czas powiadomienia o pilnej poczcie: brak pilnej poczty",
    cost: (perMailbox, target, unpricedCalls) =>
      `Koszt: $${plDecimal(perMailbox)} miesięcznie na skrzynkę (cel ≤ $${plDecimal(target)})${unpricedCalls > 0 ? `, ${unpricedCalls} ${PL_CALLS[pluralCategory("pl", unpricedCalls)]} bez ceny` : ""}`,
    category: {
      urgent: "pilne",
      needs_reply: "do odpowiedzi",
      info: "info",
      notification: "powiadomienia",
      spam: "spam",
    },
    autoEnough: (category, percent, labels) =>
      `${category} ${percent}% z ${labels} ${PL_LABELS[pluralCategory("pl", labels)]}`,
    autoLower: (percent) => `(dolna granica ${percent}%)`,
    autoFew: (category, labels, minimum) => `${category} mniej niż ${minimum} etykiet (${labels})`,
    auto: (items) => `Automat: ${items}`,
    autoNone: "Automat: żadna kategoria nie działa sama",
    autoOn: (category, proof, check) => `${category}: automat włączony · dowód ${proof} · sprawdzenie ${check}`,
    autoPaused: (category, reason) => `${category}: wstrzymane (${reason})`,
    proof: { go: "go", noGo: "no-go", none: "brak" },
    check: {
      pass: "zaliczone",
      fail: "niezaliczone",
      inconclusive: "niejednoznaczne",
      noResult: "brak wyniku",
      none: "brak",
    },
    pauseReason: {
      corrections: "poprawiono jego ruchy",
      important_hidden: "ukrył ważną wiadomość",
      model_switch: "zmienił się model AI",
      evidence_changed: "nowe wyniki testów",
      history_fail: "sprawdzenie ostatnich 30 dni nie przeszło",
    },
    review: (count) => `/review: ${PL_REVIEW[pluralCategory("pl", count)](count)} na sprawdzenie.`,
    suggestions: {
      line: (open, link) => `💡 Sugestie reguł do przejrzenia: ${open} · ${link ?? "sprawdź w panelu"}`,
    },
    // The labels are plural participles that agree with "Szkice" and stay the same for every number, so no plural table is needed.
    replyDrafts: {
      line: (c) =>
        `✍️ Szkice odpowiedzi: przygotowane ${c.made} · wysłane po zatwierdzeniu ${c.sentByTap} · wysłane z programu pocztowego ${c.sentByUser} · odrzucone ${c.rejected} · wygasłe ${c.expired} · zamknięte ${c.closed}`,
    },
  },
};
