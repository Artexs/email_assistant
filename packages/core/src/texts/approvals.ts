import type { RejectReason } from "../metrics/m3";
import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

type SetCountText = Record<"one" | "few" | "many" | "other", string>;

// One entry per fixed string or line of the approval cards, the send results, the answered-delegation card and the
// status line after a tap. A function holds the values of the line. A name or an address never gets a case ending.
export interface ApprovalTexts {
  title: {
    delegation: (to: string) => string; // `to` = "<name> <address>" or "<address>"
    clarification: (address: string) => string;
    reminder: (to: string) => string;
  };
  inactive: string; // "(inactive)"
  externalSender: string; // "⚠️ external sender"
  due: string; // "Due"
  draft: string; // "Draft:"
  bodyCut: string;
  quoted: string; // "Quoted original:"
  linksHidden: string;
  quoteCut: string;
  sendLine: string;
  buttons: {
    send: string;
    reject: string;
    sendAll: string;
    skipAll: string;
    sendAgain: string;
    wentOut: string;
    done: string;
    reasonWrongPerson: string; // after a reject: "✖️ Wrong person"
    reasonWrongContent: string;
    reasonNotNeeded: string;
    mistake: string; // on a sent mail: "⚠️ This was a mistake"
  };
  reasons: Record<RejectReason, string>; // inside a sentence, after "Reason: "
  set: {
    header: (count: number) => string;
    dueDay: (day: string) => string; // ends with ", " : it sits before the reminder number
    reminderOf: (reminder: number) => string;
    task: string; // "Task:"
    footerTemplate: string;
    footerSends: string;
  };
  closings: { delegation: string; reminder: string }; // a clarification has no closing line
  draftRemoved: string;
  draftStays: string;
  causes: {
    tries: (tries: number, code: string) => string; // code "" = none
    contentSoft: (code: string) => string; // code "" = unknown
    softCap: (code: string) => string;
    compose: (tries: number) => string;
    badPayload: string;
  };
  sendResult: {
    sent: (to: string, subject: string) => string;
    copyFailed: string;
    draftStaysNoUid: string;
    notSent: (to: string, subject: string) => string;
    refused: (stage: string, responseCode: number | null) => string; // includes "the draft stays" line
    failedStays: (cause: string) => string; // `cause` + "the draft stays"
    unknown: (to: string, subject: string) => string;
    unknownRest: string;
    expired: {
      timeout: (subject: string) => string;
      draft_missing: (subject: string) => string;
      not_notified: (subject: string) => string;
      not_seen: (subject: string) => string;
      held_timeout: (subject: string) => string;
      delegation_closed: (subject: string) => string;
      policy_changed: (subject: string) => string;
    };
    rejected: (byName: string | null, subject: string) => string;
  };
  held: { scope: string; paused: string; auth_error: string };
  edit: {
    approved: (time: string) => string;
    approvedHeld: (time: string, held: string) => string;
    rejected: (time: string) => string;
    expired: (time: string) => string;
    approvedSet: (time: string, done: number, skipped: number) => string;
    rejectedSet: (time: string, done: number, skipped: number) => string;
    wentOut: (time: string) => string;
    done: (time: string) => string;
    rejectedReason: (reason: string) => string; // no clock: the tap time is not the reject time
    markedMistake: (time: string) => string;
  };
  answered: {
    title: (name: string, subject: string) => string;
    tapDone: string;
  };
  // The answers to the reason and mistake taps (F100 stage 14).
  feedbackTaps: {
    noted: (reason: string) => string; // `reason` = an entry of `reasons`
    notRejected: string;
    off: string;
    markedMistake: string;
    alreadyMarked: string;
    tooLate: string;
    notSent: string;
  };
}

const PL_TIMES = { one: "raz", few: "razy", many: "razy", other: "razy" } as const;
const PL_SET_REMINDERS: SetCountText = {
  one: "przypomnienie",
  few: "przypomnienia",
  many: "przypomnień",
  other: "przypomnień",
};

export const approvalTexts = {
  en: {
    title: {
      delegation: (to) => `📤 Send? Delegation to ${to}`,
      clarification: (address) => `📤 Send? Question to the sender ${address}`,
      reminder: (to) => `📤 Send? Reminder to ${to}`,
    },
    inactive: "(inactive)",
    externalSender: "⚠️ external sender",
    due: "Due",
    draft: "Draft:",
    bodyCut: "(draft text cut; the full text is in the draft)",
    quoted: "Quoted original:",
    linksHidden: "(links shown as [link]; the draft has them)",
    quoteCut: "(quote cut; the draft has the full text)",
    sendLine: "The system sends it after your tap. Do not send the draft from your mail client.",
    buttons: {
      send: "📤 Send",
      reject: "✖️ Reject",
      sendAll: "📤 Send all",
      skipAll: "✖️ Skip all",
      sendAgain: "📤 Send again",
      wentOut: "✅ It went out",
      done: "✅ Done",
      reasonWrongPerson: "✖️ Wrong person",
      reasonWrongContent: "✖️ Wrong content",
      reasonNotNeeded: "Not needed",
      mistake: "⚠️ This was a mistake",
    },
    reasons: { wrong_person: "wrong person", wrong_content: "wrong content", not_needed: "not needed" },
    set: {
      header: (count) => (count === 1 ? "📤 Send 1 reminder?" : `📤 Send ${count} reminders?`),
      dueDay: (day) => `due ${day}, `,
      reminderOf: (reminder) => `reminder ${reminder} of 2`,
      task: "Task:",
      footerTemplate: "Each reminder is the fixed reminder template with this task; it quotes nothing.",
      footerSends: "The system sends them after your tap.",
    },
    closings: {
      delegation: "The delegation was cancelled.",
      reminder: "The delegation stays open.",
    },
    draftRemoved: "The draft was removed.",
    draftStays: "The draft stays in Drafts.",
    causes: {
      tries: (tries, code) => `The send failed ${tries} times${code === "" ? "" : ` (${code})`}`,
      contentSoft: (code) =>
        `The mail server refused the content for now (code ${code === "" ? "unknown" : code}); the system never retries after the content`,
      softCap: (code) =>
        `The mail server did not accept the mail for 6 hours${code === "" ? "" : ` (${code})`}; nothing was sent`,
      compose: (tries) => `The mail could not be built ${tries} times`,
      badPayload: "The stored send data is not valid; nothing was sent",
    },
    sendResult: {
      sent: (to, subject) => `✅ Sent to ${to} · ${subject}`,
      copyFailed: "No copy in Sent: the server refused the copy.",
      draftStaysNoUid: "The draft stays in Drafts (no UIDPLUS on this server).",
      notSent: (to, subject) => `❌ Not sent to ${to} · ${subject}`,
      refused: (stage, responseCode) =>
        `The mail server refused it (${stage}${responseCode === null ? "" : `, code ${responseCode}`}). The draft stays in Drafts.`,
      failedStays: (cause) => `${cause}. The draft stays in Drafts.`,
      unknown: (to, subject) => `⚠️ Unknown whether the mail to ${to} went out · ${subject}`,
      unknownRest:
        "The connection broke after the content was sent. Check Sent or ask the recipient before you send again.",
      expired: {
        timeout: (subject) => `⌛ Not sent: the approval expired (48 h) · ${subject}`,
        draft_missing: (subject) => `❌ Not sent: the draft could not be created · ${subject}`,
        not_notified: (subject) =>
          `⌛ Not sent: no approval request could go out within 7 days (no linked owner, or the draft was not created) · ${subject}`,
        not_seen: (subject) =>
          `⌛ Not sent: you did not receive the approval request (the account was paused, or it did not go out) · ${subject}`,
        held_timeout: (subject) =>
          `⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE, the send limit or the mailbox state) · ${subject}`,
        delegation_closed: (subject) => `⌛ Not sent: the delegation was closed · ${subject}`,
        policy_changed: (subject) => `⌛ Not sent: the setting was changed · ${subject}`,
      },
      rejected: (byName, subject) => `✖️ Rejected${byName === null ? "" : ` by ${byName}`} · ${subject}`,
    },
    held: {
      scope: "Sending is held by SEND_SCOPE on the server",
      paused: "The mailbox is paused, so the send waits",
      auth_error: "The mailbox login fails, so the send waits",
    },
    edit: {
      approved: (time) => `⏳ Approved ${time}, sending.`,
      approvedHeld: (time, held) =>
        `⏳ Approved ${time}. ${held}; /status shows it. It expires 48 h after the tap if it is still held.`,
      rejected: (time) => `✖️ Rejected ${time}.`,
      expired: (time) => `⌛ Expired ${time}. The mail was not sent.`,
      approvedSet: (time, done, skipped) => `⏳ Approved ${time}: ${done} sending, ${skipped} skipped.`,
      rejectedSet: (time, done, skipped) => `✖️ Skipped ${time}: ${done} rejected, ${skipped} skipped.`,
      wentOut: (time) => `✅ Marked as sent ${time}.`,
      done: (time) => `✅ Done ${time}.`,
      rejectedReason: (reason) => `✖️ Rejected. Reason: ${reason}.`,
      markedMistake: (time) => `⚠️ Marked as a mistake ${time}.`,
    },
    answered: {
      title: (name, subject) => `📩 ${name} answered · ${subject}`,
      tapDone: "Tap Done when the task is closed.",
    },
    feedbackTaps: {
      noted: (reason) => `Noted: ${reason}.`,
      notRejected: "This send is not rejected.",
      off: "This button is off now.",
      markedMistake: "⚠️ Noted as a mistake.",
      alreadyMarked: "Already marked.",
      tooLate: "Too late: a mistake can be marked within 7 days of the send.",
      notSent: "This mail was not sent.",
    },
  },
  pl: {
    title: {
      delegation: (to) => `📤 Wysłać? Zlecenie: ${to}`,
      clarification: (address) => `📤 Wysłać? Pytanie do nadawcy: ${address}`,
      reminder: (to) => `📤 Wysłać? Przypomnienie: ${to}`,
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
    draftStays: "Szkic zostaje w folderze Drafts.",
    causes: {
      tries: (tries, code) =>
        `Wysyłanie nie powiodło się ${tries} ${PL_TIMES[pluralCategory("pl", tries)]}${code === "" ? "" : ` (${code})`}`,
      contentSoft: (code) =>
        `Serwer poczty chwilowo odrzucił treść (kod: ${code === "" ? "nieznany" : code}); system nie ponawia próby po wysłaniu treści`,
      softCap: (code) =>
        `Serwer poczty nie przyjął wiadomości przez 6 godzin${code === "" ? "" : ` (${code})`}; nic nie wysłano`,
      compose: (tries) => `Nie udało się zbudować wiadomości ${tries} ${PL_TIMES[pluralCategory("pl", tries)]}`,
      badPayload: "Zapisane dane wysyłki są nieprawidłowe; nic nie wysłano",
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
        draft_missing: (subject) => `❌ Nie wysłano: nie udało się utworzyć szkicu · ${subject}`,
        not_notified: (subject) =>
          `⌛ Nie wysłano: w ciągu 7 dni nie udało się wysłać prośby o zatwierdzenie (brak połączonego właściciela albo szkic nie powstał) · ${subject}`,
        not_seen: (subject) =>
          `⌛ Nie wysłano: prośba o zatwierdzenie do ciebie nie dotarła (konto było wstrzymane albo prośba nie wyszła) · ${subject}`,
        held_timeout: (subject) =>
          `⌛ Nie wysłano: wiadomość czekała 48 h po zatwierdzeniu i nie wyszła (wstrzymana przez SEND_SCOPE, limit wysyłki albo stan skrzynki) · ${subject}`,
        delegation_closed: (subject) => `⌛ Nie wysłano: zlecenie zostało zamknięte · ${subject}`,
        policy_changed: (subject) => `⌛ Nie wysłano: ustawienie zostało zmienione · ${subject}`,
      },
      rejected: (byName, subject) => `✖️ Odrzucono${byName === null ? "" : ` (${byName})`} · ${subject}`,
    },
    held: {
      scope: "Wysyłanie jest wstrzymane przez SEND_SCOPE na serwerze",
      paused: "Skrzynka jest wstrzymana, więc wysyłanie czeka",
      auth_error: "Logowanie do skrzynki nie działa, więc wysyłanie czeka",
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
  },
} satisfies Record<UserLocale, ApprovalTexts>;
