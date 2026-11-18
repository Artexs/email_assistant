import type { ReplyBlockReason } from "../replies/eligibility";
import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

// The command names of the bot. The server keeps its own list (`channels/port.ts`); a test checks that both match.
export const botCommandNames = ["digest", "status", "pause", "resume", "review", "help"] as const;
export type BotCommandName = (typeof botCommandNames)[number];

type TriageScopeKind = "off" | "synthetic" | "all";
type SendScopeKind = "off" | "self" | "all";

// Every direct reply of the bot: the help, the link replies, /status, /pause and /resume, and the tap answers.
// One entry per sentence. A function holds the values of the text. A name or an address never gets a case ending.
export interface BotTexts {
  help: string; // the command list, with the /review line
  linked: string; // ends with `help`
  alreadyLinked: string; // ends with `help`
  linkUsed: string;
  linkExpired: string;
  error: string;
  // `operatorContact` null = "the operator".
  accountPaused: (operatorContact: string | null) => string;
  // The entries of the Telegram command menu.
  commands: Record<BotCommandName, string>;
  status: {
    title: (day: string, time: string) => string;
    noMailbox: string;
    modes: { shadow: string; assist: string };
    modeNone: string;
    mailboxLine: (mode: string, state: string) => string;
    stateActive: string;
    statePaused: (since: string) => string;
    stateAuthError: (since: string) => string;
    stateAuthErrorOAuth: (since: string) => string;
    stateHostBlocked: (since: string) => string;
    lastSync: (when: string | null, late: boolean) => string;
    llmCalls: (since: string, calls: number, cap: number) => string;
    waiting: (count: number) => string;
    triage: (scope: TriageScopeKind) => string;
    actions: (scope: TriageScopeKind, counts: { applied: number; undone: number; failed: number }) => string;
    approvals: string;
    approvalsOf: (address: string) => string;
    approvalsLine: (label: string, waiting: number, extra: { oldest: string | null; held: string | null }) => string;
    approvedPaused: (count: number) => string;
    approvedAuthError: (count: number) => string;
    approvedHostBlocked: (count: number) => string;
    approvedHeld: (count: number, scope: string) => string;
    approvedSending: (count: number) => string;
    send: (scope: SendScopeKind) => string;
    delegations: (open: number, overdue: number) => string;
    llm: (provider: string, model: string) => string;
    noDigestTimes: string;
    nextDigest: (time: string) => string;
    quietHours: (start: string, end: string) => string;
    noQuietHours: string;
  };
  switch: {
    ownerOnly: string;
    alreadyPaused: (address: string) => string;
    alreadyActive: (address: string) => string;
    loginError: (address: string) => string;
    loginErrorOAuth: (address: string) => string;
    hostBlocked: (address: string) => string;
    pausedHeader: (list: string) => string;
    pausedExplain: string;
    pausedResume: string;
    resumedHeader: (list: string) => string;
    resumedExplain: (minutes: number) => string; // minutes: the sync interval (2, 3 or 5)
    noMailbox: string;
  };
  taps: {
    invalid: string;
    cancelled: string;
    picker: { title: (subject: string, aiCategory: string) => string; cancelButton: string };
    ownerOnly: string;
    approved: string;
    approvedHeld: string;
    approvedPaused: string;
    approvedAuthError: string;
    approvedHostBlocked: string;
    alreadyApproved: (clock: string) => string;
    sending: string;
    sent: string;
    rejected: string;
    expired: string;
    failed: string;
    draftNotReady: string;
    hasGaps: string; // a reply draft that still holds a gap `[[…]]`
    featureOff: string; // the reply drafts are switched off
    rejectedNow: string;
    notFound: string;
    changed: string; // an old card of a draft that a panel edit replaced
    sendAgain: string;
    sendAgainHeld: { scope: string; paused: string; auth_error: string; host_blocked: string };
    heldNotes: { scope: string; paused: string; auth_error: string; host_blocked: string };
    sendAgainAlready: string;
    sendAgainNotFailed: string;
    sendAgainDraftGone: string;
    sendAgainDelegationClosed: string;
    setNothing: string;
    setApproved: (approved: number, skipped: number) => string;
    setApprovedHeld: (approved: number, skipped: number, note: string) => string;
    setRejected: (count: number) => string;
    done: string;
    doneAlready: string;
    doneNotClosable: string;
    wentOut: string;
    wentOutAlready: string;
    wentOutSentAgain: string;
    wentOutNotUnknown: string;
    wentOutDelegationNotOpen: string;
    // The taps and the reply text of the reply drafts (Redraft, Reply all, Use Reply-To, Draft reply).
    reply: {
      drafting: string; // the answer to "Draft reply": the card follows as a new message
      redraftAsk: string; // the answer to Redraft: the user writes one line next
      redraftQueued: string; // the message after the user's line: a new version follows
      redraftLimit: string; // the fifth redraft of one mail was made already
      instructionLength: string; // the line is empty or over 300 characters
      closed: string; // the draft does not wait any more
      recipientsDone: string;
      tooManyRecipients: string;
      noReplyTo: string;
      noOthers: string; // Reply all: the mail has no other recipient
      recipientsUnchanged: string;
      // Why a draft cannot be made now: the reasons of the eligibility rule and the closed gate of the mailbox.
      blocked: Record<ReplyBlockReason | "policy_changed", string>;
    };
  };
}

// The sync interval in the /resume text: the form follows the number (pl: "za minutę", "za 2 minuty", "za 5 minut").
const EN_MINUTES = { one: "minute", few: "minutes", many: "minutes", other: "minutes" } as const;
const PL_MINUTES = { one: "minutę", few: "minuty", many: "minut", other: "minut" } as const;

const EN_HELP = [
  "Commands:",
  "/digest – the digest now",
  "/status – mailboxes, last sync, LLM calls",
  "/pause – stop reading and triage of your mailboxes",
  "/resume – start them again",
  "/review – label a random sample of recent mail",
  "/help – this list",
  "Tap ✅ when the AI category is right, ✏️ to correct it.",
  "↩️ under a digest line undoes what the system did to that mail (7 days).",
  "📤 under an approval sends the draft; ✖️ rejects it (the draft is removed).",
  "✅ Done under an answered delegation closes it.",
].join("\n");

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

const EN_TRIAGE: Record<TriageScopeKind, string> = {
  off: "off",
  synthetic: "test mail only (TRIAGE_LLM_SCOPE=synthetic)",
  all: "real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)",
};
const EN_ACTIONS: Record<TriageScopeKind, string> = {
  off: "off",
  synthetic: "test mail only (ACTIONS_SCOPE=synthetic)",
  all: "real mail, by the mode of each mailbox (ACTIONS_SCOPE=all)",
};
const EN_SEND: Record<SendScopeKind, string> = {
  off: "off",
  self: "only to your test addresses (SEND_SCOPE=self)",
  all: "real recipients, after an owner's tap (SEND_SCOPE=all)",
};

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

export const botTexts = {
  en: {
    help: EN_HELP,
    linked: `✅ This chat is linked. Digests and urgent notices come here.\n${EN_HELP}`,
    alreadyLinked: `✅ This chat is linked already.\n${EN_HELP}`,
    linkUsed: "This link was used already. Ask for a new link.",
    linkExpired: "This link has expired (a link works for 15 minutes). Ask for a new link.",
    error: "Something went wrong. Try again later.",
    accountPaused: (operatorContact) => {
      const base = "⏸ This account is paused. Nothing changes now. To resume it, contact";
      return operatorContact === null ? `${base} the operator.` : `${base} ${operatorContact}.`;
    },
    commands: {
      digest: "The digest now",
      status: "Mailboxes, last sync, LLM calls",
      pause: "Stop reading and triage",
      resume: "Start reading and triage again",
      review: "Label a sample of recent mail",
      help: "The command list",
    },
    status: {
      title: (day, time) => `📊 Status · ${day} ${time}`,
      noMailbox: "No mailbox connected.",
      modes: { shadow: "shadow", assist: "assist" },
      modeNone: "none (no settings row: not triaged)",
      mailboxLine: (mode, state) => `Mode: ${mode} · Status: ${state}`,
      stateActive: "active",
      statePaused: (since) => `paused since ${since}`,
      stateAuthError: (since) => `login error since ${since} (run mailbox:password)`,
      stateAuthErrorOAuth: (since) => `sign-in error since ${since} (Reconnect in the panel)`,
      stateHostBlocked: (since) => `mail server not allowed since ${since} (checked again at each sync)`,
      lastSync: (when, late) => `Last sync: ${when === null ? "never" : `${when}${late ? " (late)" : ""}`}`,
      llmCalls: (since, calls, cap) => `LLM calls since ${since}: ${calls} of ${cap}`,
      waiting: (count) => `Waiting for triage: ${count}`,
      triage: (scope) => `Triage: ${EN_TRIAGE[scope]}`,
      actions: (scope, counts) =>
        `Actions: ${EN_ACTIONS[scope]} · last 24 h: applied ${counts.applied}, undone ${counts.undone}, failed ${counts.failed}`,
      approvals: "Approvals",
      approvalsOf: (address) => `Approvals ${address}`,
      approvalsLine: (label, waiting, extra) =>
        `${label}: ${waiting} waiting for your tap${extra.oldest === null ? "" : ` (oldest ${extra.oldest})`}${extra.held === null ? "" : ` · ${extra.held}`}`,
      approvedPaused: (count) => `${count} approved, held: the mailbox is paused`,
      approvedAuthError: (count) => `${count} approved, held: the mailbox login fails`,
      approvedHostBlocked: (count) => `${count} approved, held: the mail server is not allowed`,
      approvedHeld: (count, scope) => `${count} approved, held by SEND_SCOPE=${scope}`,
      approvedSending: (count) => `${count} approved, sending`,
      send: (scope) => `Send: ${EN_SEND[scope]}`,
      delegations: (open, overdue) => `Delegations: ${open} waiting for a reply, ${overdue} overdue`,
      llm: (provider, model) => `LLM: ${provider} · ${model}`,
      noDigestTimes: "No digest times set (bun run digest:times)",
      nextDigest: (time) => `Next digest: ${time}`,
      quietHours: (start, end) => `Quiet hours: ${start}–${end} (notices wait until ${end})`,
      noQuietHours: "Quiet hours: none (notices come at any time)",
    },
    switch: {
      ownerOnly: "Only the owner can pause or resume the mailboxes.",
      alreadyPaused: (address) => `${address} was paused already.`,
      alreadyActive: (address) => `${address} was active already.`,
      loginError: (address) => `❌ ${address} has a login error: run mailbox:password first.`,
      loginErrorOAuth: (address) => `❌ ${address} has a sign-in error: tap Reconnect in the panel first.`,
      hostBlocked: (address) =>
        `⛔ ${address}: its mail server is not allowed; the system checks it again at each sync.`,
      pausedHeader: (list) => `⏸ Paused: ${list}`,
      pausedExplain:
        "The system does not read or triage these mailboxes now and sends no urgent notice for them. Digests still come.",
      pausedResume: "/resume starts them again.",
      resumedHeader: (list) => `▶️ Resumed: ${list}`,
      resumedExplain: (minutes) =>
        `The next sync runs within ${minutes} ${EN_MINUTES[pluralCategory("en", minutes)]}. Mail that came during the pause is read then; mail older than 7 days is not triaged.`,
      noMailbox: "No mailbox connected.",
    },
    taps: {
      invalid: "This button is not valid any more.",
      cancelled: "✏️ Cancelled.",
      picker: {
        title: (subject, aiCategory) => `✏️ Pick the right category\n${subject}\nAI said: ${aiCategory}`,
        cancelButton: "✖️ Cancel",
      },
      ownerOnly: "Only an owner can approve or reject a send.",
      approved: "⏳ Sending within a minute.",
      approvedHeld: "Approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
      approvedPaused: "Approved. The mailbox is paused, so the send waits; /status shows it.",
      approvedAuthError:
        "Approved. The mailbox login fails, so the send waits until the password is fixed; /status shows it.",
      approvedHostBlocked:
        "Approved. The mail server of this mailbox is not allowed, so the send waits; /status shows it.",
      alreadyApproved: (clock) => `Already approved ${clock}.`,
      sending: "Already approved, sending now.",
      sent: "Already sent.",
      rejected: "This send was rejected.",
      expired: "This approval expired. The mail was not sent.",
      failed: "This send failed. See the result notice.",
      draftNotReady: "The draft is not in Drafts yet. Tap again in a minute.",
      hasGaps: "This draft still has a gap ([[…]]). Fill it in the panel first. Nothing was sent.",
      featureOff: "Reply drafts are switched off. Nothing was sent.",
      rejectedNow: "✖️ Rejected. The draft will be removed.",
      notFound: "This mail is not in your account.",
      changed: "This draft was changed. Use the newest message.",
      sendAgain: "⏳ A new send was approved. Sending within a minute.",
      sendAgainHeld: {
        scope: "A new send was approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
        paused: "A new send was approved. The mailbox is paused, so the send waits; /status shows it.",
        auth_error: "A new send was approved. The mailbox login fails, so the send waits; /status shows it.",
        host_blocked: "A new send was approved. The mail server is not allowed, so the send waits; /status shows it.",
      },
      heldNotes: {
        scope: "Sending is held by SEND_SCOPE on the server",
        paused: "The mailbox is paused, so the sends wait",
        auth_error: "The mailbox login fails, so the sends wait",
        host_blocked: "The mail server is not allowed, so the sends wait",
      },
      sendAgainAlready: "A resend was already approved for this mail.",
      sendAgainNotFailed: "This send is not in a failed state.",
      sendAgainDraftGone: "The draft is gone: the mail must be triaged again.",
      sendAgainDelegationClosed: "The delegation is closed: no resend.",
      setNothing: "Nothing to approve: the reminders were handled already.",
      setApproved: (approved, skipped) => `⏳ ${approved} reminders go out within a minute, ${skipped} skipped.`,
      setApprovedHeld: (approved, skipped, note) =>
        `⏳ ${approved} reminders approved, ${skipped} skipped. ${note}; /status shows it.`,
      setRejected: (count) => `✖️ ${count} reminders skipped.`,
      done: "✅ Done.",
      doneAlready: "Already done.",
      doneNotClosable: "This delegation is not answered yet.",
      wentOut: "✅ The delegation is marked as sent. A reply from the delegate is matched now.",
      wentOutAlready: "Already marked as sent.",
      wentOutSentAgain: "The mail was sent again: no change.",
      wentOutNotUnknown: "This send is not in the unknown state: no change.",
      wentOutDelegationNotOpen: "The delegation is not waiting for this answer any more: no change.",
      reply: {
        drafting: "✍️ Drafting. The draft comes as a new message.",
        redraftAsk: "Write one line as a reply to the message below.",
        redraftQueued: "✍️ Writing a new version. It comes as a new message.",
        redraftLimit: "This mail has 5 new versions already. Edit the draft in the panel.",
        instructionLength: "Write one line of 1 to 300 characters.",
        closed: "This draft is closed. Nothing changed.",
        recipientsDone: "👥 Recipients changed. The new version comes as a new message.",
        tooManyRecipients: "Too many recipients: a reply goes to at most 10 more people. Use the panel.",
        noReplyTo: "This mail has no other Reply-To address.",
        noOthers: "This mail has no other recipients.",
        recipientsUnchanged: "The draft already goes to these recipients.",
        blocked: {
          not_checked: "This mail is not checked yet. Try again in a few minutes.",
          category: "This mail does not need a reply.",
          junk_source: "This mail came from the spam folder. No draft.",
          not_a_person: "This mail is automatic or from a mailing list. No draft.",
          own_mailbox: "This mail is from your own mailbox. No draft.",
          suspicious: "This mail looks suspicious. No draft.",
          calendar: "This is a calendar invitation. Answer it in your calendar.",
          answered: "This mail has an answer already.",
          too_old: "This mail is too old for a draft.",
          language: "The language of this mail is not clear. No draft.",
          open_newer: "A newer mail in this thread has a draft already.",
          oauth_mailbox: "Reply drafts do not work for this kind of mailbox yet.",
          policy_changed: "Reply drafts are off for this mailbox. Turn them on in the panel.",
        },
      },
    },
  },
  pl: {
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
        redraftLimit: "Ta wiadomość ma już 5 nowych wersji. Edytuj szkic w panelu.",
        instructionLength: "Napisz jedną linijkę, od 1 do 300 znaków.",
        closed: "Ten szkic jest zamknięty. Nic się nie zmieniło.",
        recipientsDone: "👥 Zmieniono odbiorców. Nowa wersja przyjdzie w nowej wiadomości.",
        tooManyRecipients: "Zbyt wielu odbiorców: odpowiedź może trafić najwyżej do 10 dodatkowych osób. Użyj panelu.",
        noReplyTo: "Ta wiadomość nie ma innego adresu Reply-To.",
        noOthers: "Ta wiadomość nie ma innych odbiorców.",
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
  },
} satisfies Record<UserLocale, BotTexts>;
