import type { SendLimitKind } from "../send-limits";
import type { UserLocale } from "../tenancy";
import type { BarCategory } from "../triage/metrics";
import type { TripReason } from "../trust/tripwire";
import type { AuthErrorReason } from "../web/mail-oauth";

import { pluralCategory } from "./locale";

type FailedAction = "move" | "flag" | "mark_read" | "create_draft";

// The result lines of a reply request that a user waited for in Telegram (one text for each group of reason codes; the eligibility
// reasons use `bot.taps.reply.blocked`). `off`: a gate of the mailbox is closed. `generic`: a code with no own text.
export const replyResultKeys = [
  "needs_facts",
  "not_a_reply",
  "unsafe_request",
  "no_text",
  "timeout",
  "llm_cap",
  "llm_error",
  "checks",
  "output",
  "internal",
  "closed",
  "changed",
  "off",
  "mail_gone",
  "generic",
] as const;
export type ReplyResultKey = (typeof replyResultKeys)[number];

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
  // For an OAuth mailbox: replaces `mailboxRemoved`. What the owner does at the provider depends on the secret kind.
  mailboxRemovedAccess: {
    googleRevoked: string;
    googleFailed: string;
    microsoftWork: string;
    microsoftPersonal: string;
  };
  // Mail of a VIP or whitelisted sender waits while the AI service is paused.
  notTriaged: (sender: string) => string;
  // Open loops. A follow-up notice names no address and no text: the owner reads the details in the panel.
  followUp: {
    failed: string; // the send failed and nothing went out
    unknown: string; // the connection broke after the text went out: the mail may have been sent
    held: (limit: string) => string; // `limit` = an entry of `sendHeld.limit`
  };
  // The one line for an owner whose consent does not cover open-loop data (replaces a follow-up card or result).
  loopConsent: { approval: string; result: string };
  // Reply drafts: one fixed line per kind, no button. A count and a clock only: no mail text. The
  // Telegram review stages replace these lines and keep the kind names.
  // `review` is the button of the ready notice; `consent` is the line for an owner whose Telegram consent does not cover reply
  // drafts (the count only, no button).
  replyDrafts: {
    ready: (count: number, clock: string) => string;
    prompt: string; // the ForceReply message after a Redraft tap
    results: Record<ReplyResultKey, string>; // the result of a tap or a redraft that ended with no new card
    review: string;
    consent: string;
    draft: string; // the "Draft reply" button of an urgent notice
    draftRow: (n: number) => string; // the same button on a digest row
  };
  // Counts, category names and fixed phrases only. `link` is a text line, not a button.
  trustReady: {
    first: (checked: number) => string;
    recommended: (categories: string) => string;
    none: string;
    link: (url: string) => string;
  };
  autonomyPaused: {
    corrections: (category: string, count: number) => string;
    importantHidden: (category: string) => string;
    modelSwitch: (category: string) => string;
    evidenceChanged: (category: string) => string;
    historyFail: (category: string) => string;
    again: string;
    link: (url: string) => string;
  };
  sendHeld: {
    first: (address: string, limit: string) => string;
    limit: Record<SendLimitKind, string>;
    waiting: (count: number, clock: string) => string;
  };
  // The weekly report: one function per line; `rate` is a text like "33% (3 of 9)".
  weekly: {
    title: (from: string, to: string) => string; // the two days are formatted by the caller
    noMail: string;
    missed: (rate: string) => string;
    sample: (missed: number, important: number) => string;
    loopsClosed: (percent: string, counts: string) => string;
    loopsSurfaced: (percent: string, counts: string) => string;
    loops: (closed: string, surfaced: string, pending: number) => string;
    loopsNone: (pending: number) => string;
    loopsOf: (closed: string, surfaced: string) => string;
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
    // Fixed phrases only: the evidence line of a category on `auto`, and the line of a paused one.
    autoOn: (category: string, proof: string, check: string) => string;
    autoPaused: (category: string, reason: string) => string;
    proof: { go: string; noGo: string; none: string };
    check: { pass: string; fail: string; inconclusive: string; noResult: string; none: string };
    pauseReason: Record<TripReason, string>;
    review: (count: number) => string;
    // The line of the rule suggestions that wait: a count and the link to the Rules page (null: no link, a fixed phrase instead).
    suggestions: { line: (open: number, link: string | null) => string };
    // The line of the reply drafts of the week (shown only when a draft was made): the counts of the six ends.
    replyDrafts: {
      line: (counts: {
        made: number;
        sentByTap: number;
        sentByUser: number;
        rejected: number;
        expired: number;
        closed: number;
      }) => string;
    };
  };
}

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
    replyDrafts: {
      ready: (count, clock) => `✍️ ${count} reply ${count === 1 ? "draft is" : "drafts are"} ready (${clock}).`,
      prompt: "✍️ Write one line: what should the reply say?",
      results: {
        needs_facts: "✍️ No draft: the reply needs facts that are not in the mail. Write it yourself.",
        not_a_reply: "✍️ No draft: this mail does not need a reply.",
        unsafe_request: "✍️ No draft: this mail asks for something that needs your own decision.",
        no_text: "✍️ No draft: the text of the mail is not stored any more.",
        timeout: "✍️ The draft took too long. Try once more.",
        llm_cap: "✍️ The daily limit of AI calls for this mailbox is reached. Try again tomorrow.",
        llm_error: "✍️ The AI service failed. Try again later.",
        checks: "✍️ The draft did not pass the safety checks. Try again or write the reply yourself.",
        output: "✍️ The AI gave no usable answer. Try again.",
        internal: "✍️ Something went wrong. Try again later.",
        closed: "✍️ This draft was closed; nothing changed.",
        changed: "✍️ Another version replaced this draft meanwhile. Use the newest message.",
        off: "✍️ Reply drafts are off for this mailbox. Turn them on in the panel.",
        mail_gone: "✍️ The mail is not available any more.",
        generic: "✍️ No draft was made.",
      },
      review: "📝 Review",
      consent: "Confirm the new Telegram terms in the panel to review here.",
      draft: "✍️ Draft reply",
      draftRow: (n) => `✍️ ${n}`,
    },
    trustReady: {
      first: (checked) =>
        `📋 Your check is ready: I looked at ${checked} ${checked === 1 ? "mail" : "mails"} from the last 30 days.`,
      recommended: (categories) => `Recommended: ${categories}`,
      none: "Nothing to turn on yet.",
      link: (url) => `Report: ${url}`,
    },
    autonomyPaused: {
      corrections: (category, count) =>
        `⏸ Automatic moves for ${category} are off: you corrected ${count} of them in 7 days.`,
      importantHidden: (category) => `⏸ Automatic moves for ${category} are off: one of them hid a mail you needed.`,
      modelSwitch: (category) =>
        `⏸ Automatic moves for ${category} are off: the AI model changed and has no proof yet for this category.`,
      evidenceChanged: (category) =>
        `⏸ Automatic moves for ${category} are off: new test results no longer support them.`,
      historyFail: (category) =>
        `⏸ Automatic moves for ${category} are off: the check of your last 30 days found mail you needed among them.`,
      again: "Turn them on again in Settings.",
      link: (url) => `Settings: ${url}`,
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
      loopsOf: (closed, surfaced) => `Of which loops: ${closed}, ${surfaced}`,
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
      autoOn: (category, proof, check) => `${category}: auto on · proof ${proof} · check ${check}`,
      autoPaused: (category, reason) => `${category}: paused (${reason})`,
      proof: { go: "go", noGo: "no-go", none: "none" },
      check: { pass: "pass", fail: "fail", inconclusive: "inconclusive", noResult: "no result", none: "none" },
      pauseReason: {
        corrections: "you corrected its moves",
        important_hidden: "it hid a mail you needed",
        model_switch: "the AI model changed",
        evidence_changed: "new test results",
        history_fail: "the check of your last 30 days failed",
      },
      review: (count) => `/review: ${count} replied ${count === 1 ? "mail waits" : "mails wait"} for a check.`,
      suggestions: {
        line: (open, link) =>
          `💡 ${open} rule ${open === 1 ? "suggestion waits" : "suggestions wait"} for you · ${link ?? (open === 1 ? "check it in the panel" : "check them in the panel")}`,
      },
      replyDrafts: {
        line: (c) =>
          `✍️ Reply drafts: ${c.made} made · ${c.sentByTap} sent by tap · ${c.sentByUser} sent by you · ${c.rejected} rejected · ${c.expired} expired · ${c.closed} closed`,
      },
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
      // The verbs have one form for every number (impersonal past), so no plural table is needed.
      replyDrafts: {
        line: (c) =>
          `✍️ Szkice odpowiedzi: przygotowano ${c.made} · wysłano stuknięciem ${c.sentByTap} · wysłano przez ciebie ${c.sentByUser} · odrzucono ${c.rejected} · wygasło ${c.expired} · zamknięto ${c.closed}`,
      },
    },
  },
} satisfies Record<UserLocale, NoticeTexts>;
