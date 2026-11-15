import type { SendLimitKind } from "../send-limits";
import type { UserLocale } from "../tenancy";
import type { BarCategory } from "../triage/metrics";
import type { AuthErrorReason } from "../web/mail-oauth";

import { pluralCategory } from "./locale";

type FailedAction = "move" | "flag" | "mark_read" | "create_draft";

// One entry per line that a notice prints; a function where the line holds values.
export interface NoticeTexts {
  urgentTitle: string;
  received: (clock: string) => string;
  authError: {
    first: (address: string, since: string) => string;
    noRead: string;
    fix: (mailboxId: string) => string;
    // For an OAuth mailbox: replaces `fix`. `provider` is the display name; `reason` null is a refusal with no known cause.
    fixOAuth: (provider: string, reason: AuthErrorReason | null) => string;
  };
  hostBlocked: { first: (address: string, since: string) => string; why: string; noRead: string; recheck: string };
  sentMissing: { first: (address: string, since: string) => string; ask: string };
  syncStale: { first: (address: string) => string; last: (last: string) => string; status: string; never: string };
  syncOk: (address: string, last: string) => string;
  actionFailed: {
    first: Record<FailedAction, { original: string; reverse: string }>;
    toFolder: (folder: string) => string; // appended to the first line of a failed move
    tried: (count: number) => string;
    notFound: string;
    badPayload: (folder: string) => string;
    staysIn: (folder: string) => string;
    staysInAiFolder: (folder: string | null) => string;
    draftStays: string;
    status: string;
  };
  mailboxRemoved: string;
  // For an OAuth mailbox (F117): replaces `mailboxRemoved`. What the owner does at the provider depends on the secret kind.
  mailboxRemovedAccess: {
    googleRevoked: string;
    googleFailed: string;
    microsoftWork: string;
    microsoftPersonal: string;
  };
  // F109 stage 15: mail of a VIP or whitelisted sender waits while the AI service is paused.
  notTriaged: (sender: string) => string;
  // Open loops (F116 stage 11). A follow-up notice names no address and no text: the owner reads the details in the panel.
  followUp: {
    failed: string; // the send failed and nothing went out
    unknown: string; // the connection broke after the text went out: the mail may have been sent
    held: (limit: string) => string; // `limit` = an entry of `sendHeld.limit`
  };
  // The one line for an owner whose consent does not cover open-loop data (replaces a follow-up card or result).
  loopConsent: { approval: string; result: string };
  sendHeld: {
    first: (address: string, limit: string) => string;
    limit: Record<SendLimitKind, string>;
    waiting: (count: number, clock: string) => string;
  };
  // The weekly report (F100 stage 16): one function per line; `rate` is a text like "33% (3 of 9)".
  weekly: {
    title: (from: string, to: string) => string; // the two days are formatted by the caller
    noMail: string;
    missed: (rate: string) => string;
    sample: (missed: number, important: number) => string;
    loopsClosed: (percent: string, counts: string) => string;
    loopsSurfaced: (percent: string, counts: string) => string;
    loops: (closed: string, surfaced: string, pending: number) => string;
    loopsNone: (pending: number) => string;
    mistakes: {
      total: (count: number) => string;
      hiddenImportant: (count: number) => string;
      wrongPerson: (count: number) => string;
      wrongContent: (count: number) => string;
      sentByMistake: (count: number) => string;
    };
    handled: (rate: string) => string;
    wouldHandle: (rate: string) => string;
    urgent: (p90: number | null, noticed: number, withoutNotice: number) => string;
    urgentNone: string;
    cost: (perMailbox: string, target: number, unpricedCalls: number) => string;
    category: Record<BarCategory, string>;
    autoEnough: (category: string, percent: number, labels: number) => string;
    autoLower: (percent: number) => string;
    autoFew: (category: string, labels: number, minimum: number) => string;
    auto: (items: string) => string;
    autoNone: string;
    review: (count: number) => string;
  };
}

const PL_TIMES = { one: "raz", few: "razy", many: "razy", other: "razy" } as const;

const PL_WAITING = {
  one: (count: number) => `${count} wiadomość czeka`,
  few: (count: number) => `${count} wiadomości czekają`,
  many: (count: number) => `${count} wiadomości czeka`,
  other: (count: number) => `${count} wiadomości czeka`,
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

export const noticeTexts = {
  en: {
    urgentTitle: "🔴 Urgent mail",
    received: (clock) => `Received ${clock}`,
    authError: {
      first: (address, since) => `❌ Login to ${address} failed at ${since}.`,
      noRead: "The system does not read this mailbox now. No mail is lost: it stays on the mail server.",
      fix: (mailboxId) =>
        `To fix it: check the password, then run mailbox:password for mailbox ${mailboxId} (runbook: deploy/README.md).`,
      fixOAuth: (provider, reason) => {
        switch (reason) {
          case "oauth_expired":
            return `The sign-in to ${provider} expired. Open the panel, Mailboxes, and tap Reconnect.`;
          case "oauth_revoked":
            return `Access to the mailbox was withdrawn at ${provider}. Open the panel, Mailboxes, and tap Reconnect.`;
          case "admin_consent_required":
            return `This app needs approval at ${provider}, from you or from your administrator. Open the panel, Mailboxes: tap Reconnect, or use the approval link there.`;
          case "protocol_disabled":
            return "Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on, then tap Reconnect in the panel.";
          case null:
            return `The sign-in to ${provider} fails. Open the panel, Mailboxes, and tap Reconnect.`;
        }
      },
    },
    hostBlocked: {
      first: (address, since) => `⛔ The system stopped connecting to the mail server of ${address} at ${since}.`,
      why: "The server name points to a private or local network address, and the system never connects there.",
      noRead:
        "The system does not read or send mail of this mailbox now. No mail is lost: it stays on the mail server.",
      recheck:
        "The system checks the server again at each sync and starts the mailbox again by itself. /status shows the state.",
    },
    sentMissing: {
      first: (address, since) => `📭 No sent mail seen for ${address} since ${since}.`,
      ask: "Does your mail app keep a copy in Sent? The assistant needs it to see what you wait for.",
    },
    syncStale: {
      first: (address) => `⚠️ Mail sync is late for ${address}.`,
      last: (last) => `Last good sync: ${last}. The system keeps trying.`,
      status: "/status shows the state.",
      never: "never",
    },
    syncOk: (address, last) => `✅ Mail sync works again for ${address}. Last sync ${last}.`,
    actionFailed: {
      first: {
        move: { original: "Could not move a mail", reverse: "Undo failed: could not move a mail back to" },
        flag: { original: "Could not flag a mail", reverse: "Undo failed: could not remove the flag" },
        mark_read: { original: "Could not mark a mail read", reverse: "Undo failed: could not mark a mail unread" },
        create_draft: { original: "Could not create a draft", reverse: "Could not remove the draft for a mail" },
      },
      toFolder: (folder) => ` to ${folder}`,
      tried: (count) => `Tried ${count} ${count === 1 ? "time" : "times"}.`,
      notFound: "The mail was not found: it was moved or deleted in the mail client.",
      badPayload: (folder) => `The plan had an unknown folder. The mail stays in ${folder}.`,
      staysIn: (folder) => `The mail stays in ${folder}.`,
      staysInAiFolder: (folder) => `The mail stays in ${folder ?? "its AI folder"}: move it by hand.`,
      draftStays: "The draft stays in Drafts: delete it by hand.",
      status: "/status shows the mailbox state.",
    },
    mailboxRemoved: "Mailbox removed. Change its password in your mail provider's settings now.",
    mailboxRemovedAccess: {
      googleRevoked: "Mailbox removed. Its Google access is withdrawn.",
      googleFailed: "Mailbox removed. Withdraw its access at myaccount.google.com/permissions now.",
      microsoftWork: "Mailbox removed. Withdraw the app's access at myapps.microsoft.com now.",
      microsoftPersonal: "Mailbox removed. Withdraw the app's access at account.live.com/consent/Manage now.",
    },
    notTriaged: (sender) =>
      `📭 Mail from ${sender} is not triaged yet: the AI service is paused. It is triaged when the service is back.`,
    followUp: {
      failed: "⚠️ A follow-up could not be sent. Nothing went out.",
      unknown:
        "⚠️ A follow-up may have been sent: the connection broke after the text went out. Check your Sent folder before you write another.",
      held: (limit) => `⏸ A follow-up waits: ${limit}.`,
    },
    loopConsent: {
      approval: "A follow-up waits for your approval in the panel.",
      result: "A follow-up has a new result in the panel.",
    },
    sendHeld: {
      first: (address, limit) => `⏸ Sends from ${address} wait: ${limit}.`,
      limit: {
        mailbox_hour: "the hourly send limit of this mailbox is reached",
        mailbox_day: "the daily send limit of this mailbox is reached",
        recipient_day: "the daily limit for one recipient is reached",
      },
      waiting: (count, clock) => `${count} waiting; the next one goes out at about ${clock}.`,
    },
    weekly: {
      title: (from, to) => `📈 Week ${from} – ${to}`,
      noMail: "No mail this week.",
      missed: (rate) => `Missed important mail (lower bound): ${rate}`,
      sample: (missed, important) => `Random review sample: ${missed} missed of ${important}`,
      loopsClosed: (percent, counts) => `${percent} closed ${counts}`,
      loopsSurfaced: (percent, counts) => `${percent} surfaced ${counts}`,
      loops: (closed, surfaced, pending) =>
        `Open loops on time: ${closed}, ${surfaced}${pending > 0 ? `, ${pending} still open` : ""}`,
      loopsNone: (pending) =>
        `Open loops on time: no delegation was due${pending > 0 ? `, ${pending} still open` : ""}`,
      mistakes: {
        total: (count) => `Serious mistakes: ${count}`,
        hiddenImportant: (count) => `hidden important ${count}`,
        wrongPerson: (count) => `wrong person ${count}`,
        wrongContent: (count) => `wrong content ${count}`,
        sentByMistake: (count) => `sent by mistake ${count}`,
      },
      handled: (rate) => `Handled for you: ${rate}`,
      wouldHandle: (rate) => `Would handle (shadow mode): ${rate}`,
      urgent: (p90, noticed, withoutNotice) =>
        `Urgent notice time: p90 ${p90 === null ? "–" : `${p90} min`} (${noticed} ${noticed === 1 ? "notice" : "notices"}${withoutNotice > 0 ? `, ${withoutNotice} without a notice` : ""})`,
      urgentNone: "Urgent notice time: no urgent mail",
      cost: (perMailbox, target, unpricedCalls) =>
        `Cost: $${perMailbox} per mailbox per month (target ≤ $${target})${unpricedCalls > 0 ? `, ${unpricedCalls} ${unpricedCalls === 1 ? "call" : "calls"} without a price` : ""}`,
      category: { urgent: "urgent", needs_reply: "reply", info: "info", notification: "notification", spam: "spam" },
      autoEnough: (category, percent, labels) => `${category} ${percent}% of ${labels} labels`,
      autoLower: (percent) => `(lower bound ${percent}%)`,
      autoFew: (category, labels, minimum) => `${category} fewer than ${minimum} labels (${labels})`,
      auto: (items) => `Auto: ${items}`,
      autoNone: "Auto: no category on auto",
      review: (count) => `/review: ${count} replied ${count === 1 ? "mail waits" : "mails wait"} for a check.`,
    },
  },
  pl: {
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
      result: "Jest nowy wynik dotyczący przypomnienia o odpowiedzi. Zobacz go w panelu.",
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
      review: (count) => `/review: ${PL_REVIEW[pluralCategory("pl", count)](count)} na sprawdzenie.`,
    },
  },
} satisfies Record<UserLocale, NoticeTexts>;
