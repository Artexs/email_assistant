import type { ApprovalTexts } from "./approvals";
import { pluralCategory } from "./locale";

const PL_TIMES = { one: "raz", few: "razy", many: "razy", other: "razy" } as const;
const PL_SET_REMINDERS: Record<"one" | "few" | "many" | "other", string> = {
  one: "przypomnienie",
  few: "przypomnienia",
  many: "przypomnień",
  other: "przypomnień",
};

export const approvalsPl: ApprovalTexts = {
  title: {
    delegation: (to) => `📤 Wysłać? Zlecenie: ${to}`,
    clarification: (address) => `📤 Wysłać? Pytanie do nadawcy: ${address}`,
    reminder: (to) => `📤 Wysłać? Przypomnienie: ${to}`,
    reply: (address) => `✍️ Odpowiedź do ${address}`,
  },
  followUp: {
    title: "📝 Przypomnienie o odpowiedzi",
    to: "Do:",
    cc: "DW:",
    number: (n) => `Przypomnienie ${n} z 2`,
    sent: (to) => `✅ Przypomnienie o odpowiedzi wysłane do ${to}`,
    rejected: (byName) => `✖️ Przypomnienie o odpowiedzi odrzucone${byName === null ? "" : ` (${byName})`}`,
    expired: {
      timeout: "⌛ Nie wysłano przypomnienia o odpowiedzi: zatwierdzenie wygasło (48 h).",
      draft_missing:
        "❌ Nie wysłano przypomnienia o odpowiedzi: szkicu nie ma w folderze Drafts (nie powstał albo został usunięty, przeniesiony lub wysłany w programie pocztowym).",
      not_notified:
        "⌛ Nie wysłano przypomnienia o odpowiedzi: w ciągu 7 dni nie udało się wysłać prośby o zatwierdzenie.",
      not_seen: "⌛ Nie wysłano przypomnienia o odpowiedzi: prośba o zatwierdzenie do Ciebie nie dotarła.",
      held_timeout: "⌛ Nie wysłano przypomnienia o odpowiedzi: czekało 48 h po zatwierdzeniu i nie wyszło.",
      delegation_closed: "⌛ Nie wysłano przypomnienia o odpowiedzi: zlecenie zostało zamknięte.",
      policy_changed: "⌛ Nie wysłano przypomnienia o odpowiedzi: ustawienie zostało zmienione.",
      loop_closed: "⌛ Nie wysłano przypomnienia o odpowiedzi: sprawa została zamknięta.",
      draft_changed:
        "✏️ Nie wysłano przypomnienia o odpowiedzi: szkic został zmieniony w programie pocztowym. Wyślij go stamtąd.",
    },
  },
  reply: {
    to: "Do:",
    cc: "DW:",
    replyTo: "Reply-To:",
    fill: (gaps) => `⚠️ Uzupełnij: ${gaps}. Zrób to w panelu; do tego czasu nie możesz wysłać tego szkicu.`,
    sentHidden: "Nie widzę Twojej wysłanej poczty. Sprawdź, czy ta wiadomość nie ma już odpowiedzi.",
    skip: "⏭ Pomiń",
    noMore: "Nie ma więcej szkiców odpowiedzi do przejrzenia.",
    redraft: "✍️ Napisz inaczej",
    replyAll: "👥 Odpowiedz wszystkim",
    useReplyTo: "↩️ Użyj Reply-To",
  },
  inactive: "(nieaktywny wykonawca)",
  externalSender: "⚠️ nadawca zewnętrzny",
  due: "Termin",
  draft: "Szkic:",
  bodyCut: "(tekst szkicu skrócony; pełny tekst jest w szkicu)",
  quoted: "Cytowany oryginał:",
  linksHidden: "(linki pokazane jako [link]; szkic je zawiera)",
  quoteCut: "(cytat skrócony; pełny tekst jest w szkicu)",
  sendLine: "System wyśle wiadomość po naciśnięciu przycisku. Nie wysyłaj szkicu z programu pocztowego.",
  sendLineEditable:
    "System wyśle wiadomość po naciśnięciu przycisku. Edytuj tutaj albo edytuj i wyślij w programie pocztowym.",
  versionLine: (version) => `✏️ Wersja ${version}.`,
  panelLine: (url) => `Otwórz w panelu: ${url}`,
  buttons: {
    send: "📤 Wyślij",
    reject: "✖️ Odrzuć",
    sendAll: "📤 Wyślij wszystkie",
    skipAll: "✖️ Pomiń wszystkie",
    sendAgain: "📤 Wyślij ponownie",
    wentOut: "✅ Wysłano",
    done: "✅ Gotowe",
    reasonWrongPerson: "✖️ Zła osoba",
    reasonWrongContent: "✖️ Zła treść",
    reasonNotNeeded: "Niepotrzebne",
    mistake: "⚠️ To był błąd",
  },
  reasons: { wrong_person: "zła osoba", wrong_content: "zła treść", not_needed: "niepotrzebne" },
  set: {
    header: (count) => `📤 Wysłać ${count} ${PL_SET_REMINDERS[pluralCategory("pl", count)]}?`,
    dueDay: (day) => `termin: ${day}, `,
    reminderOf: (reminder) => `przypomnienie ${reminder} z 2`,
    task: "Zadanie:",
    footerTemplate: "Każde przypomnienie to stały szablon przypomnienia z tym zadaniem; niczego nie cytuje.",
    footerSends: "System wyśle je po naciśnięciu przycisku.",
  },
  closings: {
    delegation: "Zlecenie zostało anulowane.",
    reminder: "Zlecenie zostaje otwarte.",
  },
  draftRemoved: "Szkic został usunięty.",
  followUpRemoved: "↩️ Przypomnienie o odpowiedzi usunięte: śledzenie Twojej wysłanej poczty jest wyłączone.",
  draftStays: "Szkic zostaje w folderze Drafts.",
  causes: {
    tries: (tries, code) =>
      `Wysyłanie nie powiodło się ${tries} ${PL_TIMES[pluralCategory("pl", tries)]}${code === "" ? "" : ` (${code})`}`,
    contentSoft: (code) =>
      `Serwer poczty chwilowo odrzucił treść (kod: ${code === "" ? "nieznany" : code}); system nie ponawia próby po wysłaniu treści`,
    softCap: (code) =>
      `Serwer poczty nie przyjął wiadomości przez 6 godzin${code === "" ? "" : ` (${code})`}; nic nie wysłano`,
    copyCheck: (code) =>
      `System nie mógł odczytać szkicu w Twojej skrzynce${code === "" ? "" : ` (${code})`}; nic nie wysłano`,
    compose: (tries) => `Nie udało się zbudować wiadomości ${tries} ${PL_TIMES[pluralCategory("pl", tries)]}`,
    badPayload: "Zapisane dane wysyłki są nieprawidłowe; nic nie wysłano",
    hasGaps: "W odpowiedzi nadal jest luka oznaczona [[ ]], której nikt nie uzupełnił; nic nie wysłano",
  },
  sendResult: {
    sent: (to, subject) => `✅ Wysłano do: ${to} · ${subject}`,
    copyFailed: "Brak kopii w folderze Sent: serwer odrzucił kopię.",
    draftStaysNoUid: "Szkic zostaje w folderze Drafts (ten serwer nie obsługuje UIDPLUS).",
    notSent: (to, subject) => `❌ Nie wysłano do: ${to} · ${subject}`,
    refused: (stage, responseCode) =>
      `Serwer poczty odrzucił wiadomość (${stage}${responseCode === null ? "" : `, kod: ${responseCode}`}). Szkic zostaje w folderze Drafts.`,
    failedStays: (cause) => `${cause}. Szkic zostaje w folderze Drafts.`,
    unknown: (to, subject) => `⚠️ Nie wiadomo, czy wiadomość wyszła do: ${to} · ${subject}`,
    unknownRest:
      "Połączenie zostało przerwane po wysłaniu treści. Sprawdź folder Sent lub zapytaj odbiorcę, zanim wyślesz ponownie.",
    expired: {
      timeout: (subject) => `⌛ Nie wysłano: zatwierdzenie wygasło (48 h) · ${subject}`,
      timeoutReply: (subject) => `⌛ Nie wysłano: nikt nie zatwierdził szkicu w ciągu 7 dni · ${subject}`,
      draft_missing: (subject) =>
        `❌ Nie wysłano: szkicu nie ma w folderze Drafts (nie powstał albo został usunięty, przeniesiony lub wysłany w programie pocztowym) · ${subject}`,
      not_notified: (subject) =>
        `⌛ Nie wysłano: w ciągu 7 dni nie udało się wysłać prośby o zatwierdzenie (brak połączonego właściciela albo szkic nie powstał) · ${subject}`,
      not_seen: (subject) =>
        `⌛ Nie wysłano: prośba o zatwierdzenie do ciebie nie dotarła (konto było wstrzymane albo prośba nie wyszła) · ${subject}`,
      held_timeout: (subject) =>
        `⌛ Nie wysłano: wiadomość czekała 48 h po zatwierdzeniu i nie wyszła (wstrzymana przez SEND_SCOPE, limit wysyłki albo stan skrzynki) · ${subject}`,
      delegation_closed: (subject) => `⌛ Nie wysłano: zlecenie zostało zamknięte · ${subject}`,
      policy_changed: (subject) => `⌛ Nie wysłano: ustawienie zostało zmienione · ${subject}`,
      loop_closed: (subject) => `⌛ Nie wysłano: sprawa została zamknięta · ${subject}`,
      draft_changed: (subject) => `✏️ Szkic został zmieniony w programie pocztowym. Wyślij go stamtąd. · ${subject}`,
      answered: (subject) => `⌛ Na tę wiadomość już odpowiedziano. System nic nie wysłał. · ${subject}`,
      sent_by_user: (subject) =>
        `⌛ Wygląda na to, że odpowiedź wysłano z programu pocztowego. System nic nie wysłał. · ${subject}`,
      newer_mail: (subject) =>
        `⌛ W tym wątku pojawiła się nowsza wiadomość. Nic nie wysłano. Przeczytaj nowszą wiadomość; może pojawić się nowy szkic. · ${subject}`,
      original_moved: (subject) =>
        `⌛ Wiadomość przeniesiono do innego folderu. Nic nie wysłano. Jeśli nadal chcesz odpowiedzieć, zrób to z jej nowego miejsca. · ${subject}`,
      suspicious: (subject) =>
        `⌛ Po utworzeniu szkicu wiadomość oznaczono jako podejrzaną. Nic nie wysłano. Przeczytaj ją uważnie; może pojawić się nowy szkic. · ${subject}`,
    },
    rejected: (byName, subject) => `✖️ Odrzucono${byName === null ? "" : ` (${byName})`} · ${subject}`,
  },
  held: {
    scope: "Wysyłanie jest wstrzymane przez SEND_SCOPE na serwerze",
    paused: "Skrzynka jest wstrzymana, więc wysyłanie czeka",
    auth_error: "Logowanie do skrzynki nie działa, więc wysyłanie czeka",
    host_blocked: "Serwer poczty jest niedozwolony, więc wysyłanie czeka",
  },
  edit: {
    approved: (time) => `⏳ Zatwierdzono ${time}, trwa wysyłanie.`,
    approvedHeld: (time, held) =>
      `⏳ Zatwierdzono ${time}. ${held}; /status pokazuje szczegóły. Zatwierdzenie wygaśnie 48 h po naciśnięciu przycisku, jeśli wysyłanie nadal będzie wstrzymane.`,
    rejected: (time) => `✖️ Odrzucono ${time}.`,
    expired: (time) => `⌛ Wygasło ${time}. Wiadomość nie została wysłana.`,
    approvedSet: (time, done, skipped) => `⏳ Zatwierdzono ${time}. Wysyłanie: ${done} (pominięto ${skipped}).`,
    rejectedSet: (time, done, skipped) => `✖️ Pominięto ${time}. Odrzucono: ${done} (pominięto ${skipped}).`,
    wentOut: (time) => `✅ Oznaczono jako wysłane ${time}.`,
    done: (time) => `✅ Gotowe ${time}.`,
    rejectedReason: (reason) => `✖️ Odrzucono. Powód: ${reason}.`,
    markedMistake: (time) => `⚠️ Oznaczono jako błąd ${time}.`,
    changed: (time) => `✏️ Zmieniono ${time}. Nowa wersja przyjdzie w osobnej wiadomości.`,
    skipped: (time) => `⏭ Pominięto ${time}. Szkic zostaje w panelu.`,
  },
  answered: {
    title: (name, subject) => `📩 Odpowiedź od: ${name} · ${subject}`,
    tapDone: "Naciśnij „Gotowe”, gdy zadanie zostanie zamknięte.",
  },
  feedbackTaps: {
    noted: (reason) => `Zapisano: ${reason}.`,
    notRejected: "Ta wysyłka nie została odrzucona.",
    off: "Ten przycisk jest teraz wyłączony.",
    markedMistake: "⚠️ Oznaczono jako błąd.",
    alreadyMarked: "Już oznaczono.",
    tooLate: "Za późno: błąd można oznaczyć w ciągu 7 dni od wysyłki.",
    notSent: "Ta wiadomość nie została wysłana.",
  },
};
