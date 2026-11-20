import type { Texts } from "./texts";

// How long a category is kept. One period per category.
//   orgSetting       `organizations.data_retention_days`; `defaultDays` is the column default
//   days             a fixed number of days after the row was made (or last changed)
//   daysAfterClose   a fixed number of days after the row is closed or done
//   afterExpiry      a fixed number of days after the row expires; a period of hours counts as 1 day (the upper bound)
//   untilDelete      no job clears it; `scope` says what ends it (`docs/capabilities/account-data.md`):
//                    mailbox       the removal of the mailbox, or the delete of the organization
//                    member        the member (the panel or the CLI removes the item), or the delete of the organization
//                    organization  the delete of the organization (no code removes a member or a mailbox with it)
export type Kept =
  | { kind: "orgSetting"; defaultDays: number }
  | { kind: "days"; days: number }
  | { kind: "daysAfterClose"; days: number }
  | { kind: "afterExpiry"; days: number }
  | { kind: "untilDelete"; scope: "mailbox" | "member" | "organization" };

// What the system stores, about whom and for how long. The privacy page and the records of processing read this list. A
// test ties it to the database: every table is in a category or in `NO_PERSONAL_DATA_TABLES`.
//
// `columns` entries are `table.column` or `table.*`. A table may span categories, because retention is per column. A
// table that spans lists the columns that carry text, addresses or a retention rule; its ids, counters, times and status
// codes stay with the row and are not listed. A column is in at most one category; `table.*` takes the whole table.
export interface DataCategory {
  id: string;
  label: Texts;
  purpose: Texts;
  columns: readonly string[];
  /** `users`: members of the organization. `others`: people who are not members (senders, recipients, delegates). */
  subjects: readonly ("users" | "others")[];
  kept: Kept;
}

const untilMailbox: Kept = { kind: "untilDelete", scope: "mailbox" };
const untilMember: Kept = { kind: "untilDelete", scope: "member" };
const untilOrganization: Kept = { kind: "untilDelete", scope: "organization" };

export const dataCategories: readonly DataCategory[] = [
  {
    id: "account",
    label: { en: "Account", pl: "Konto" },
    purpose: {
      en: "Sign-in, sessions, two-factor, language, consent and role of a member",
      pl: "Logowanie, sesje, uwierzytelnianie dwuskładnikowe, język, zgody i rola członka",
    },
    columns: [
      "users.*",
      "auth_accounts.*",
      "auth_sessions.*",
      "auth_two_factors.*",
      "auth_lockouts.*",
      "memberships.*",
    ],
    subjects: ["users"],
    kept: untilOrganization,
  },
  {
    id: "organization",
    label: { en: "Organization and mailbox setup", pl: "Organizacja i ustawienia skrzynek" },
    purpose: {
      en: "Organization settings, connected mailboxes, folders, mode and switches, single sign-on",
      pl: "Ustawienia organizacji, połączone skrzynki, foldery, tryb i przełączniki, jednokrotne logowanie",
    },
    columns: [
      "organizations.*",
      "sso_providers.*",
      "mailboxes.*",
      "mailbox_settings.*",
      "mailbox_folders.*",
      "mailbox_sent_sync.*",
    ],
    subjects: ["users"],
    kept: untilMailbox,
  },
  {
    id: "mailbox-secret",
    label: { en: "Mailbox secret", pl: "Sekret skrzynki" },
    purpose: {
      en: "The encrypted password or token that opens a mailbox",
      pl: "Zaszyfrowane hasło lub token, który otwiera skrzynkę",
    },
    columns: ["mailbox_credentials.*"],
    subjects: ["users"],
    kept: untilMailbox,
  },
  {
    id: "sign-in-tokens",
    label: { en: "Short-lived tokens", pl: "Krótkotrwałe tokeny" },
    purpose: {
      en: "Reset and invite tokens, Telegram link tokens and mailbox sign-in states",
      pl: "Tokeny resetu i zaproszenia, tokeny łączenia Telegrama i stany logowania do skrzynki",
    },
    // Link tokens go 1 day after use or expiry, reset and invite tokens 1 day after expiry, sign-in states 1 hour after expiry.
    columns: ["auth_verifications.*", "chat_link_tokens.*", "mailbox_oauth_states.*"],
    subjects: ["users"],
    kept: { kind: "afterExpiry", days: 1 },
  },
  {
    id: "mail-body",
    label: { en: "Mail body text", pl: "Treść wiadomości" },
    purpose: {
      en: "The text of received and sent mail, read by the AI and shown in drafts",
      pl: "Treść otrzymanych i wysłanych wiadomości, czytana przez AI i pokazywana w szkicach",
    },
    columns: ["emails.body_text", "sent_emails.body_text"],
    subjects: ["users", "others"],
    kept: { kind: "orgSetting", defaultDays: 30 },
  },
  {
    id: "captured-headers",
    label: { en: "Captured headers", pl: "Zapisane nagłówki" },
    purpose: {
      en: "Header facts of a mail: sender name, reply-to, return path, authentication results, list data, attachments and links",
      pl: "Dane z nagłówków wiadomości: nazwa nadawcy, reply-to, return-path, wyniki uwierzytelnienia, dane listy, załączniki i linki",
    },
    columns: ["email_headers.*"],
    subjects: ["users", "others"],
    kept: { kind: "orgSetting", defaultDays: 30 },
  },
  {
    id: "mail-headers",
    label: { en: "Subject and addresses", pl: "Temat i adresy" },
    purpose: {
      en: "The subject and the addresses of received and sent mail",
      pl: "Temat i adresy otrzymanych i wysłanych wiadomości",
    },
    columns: [
      "emails.subject",
      "emails.from_address",
      "emails.from_address_lower",
      "emails.to_addresses",
      "emails.cc_addresses",
      "emails.in_reply_to",
      "emails.references_header",
      "sent_emails.subject",
      "sent_emails.from_address",
      "sent_emails.to_addresses",
      "sent_emails.cc_addresses",
      "sent_emails.references_ids",
    ],
    subjects: ["users", "others"],
    kept: { kind: "days", days: 90 },
  },
  {
    id: "mail-ids",
    label: { en: "Mail identifiers", pl: "Identyfikatory wiadomości" },
    purpose: {
      en: "Message identifiers, thread keys and hashes that the sync uses to find a mail",
      pl: "Identyfikatory wiadomości, klucze wątków i skróty, po których synchronizacja znajduje wiadomość",
    },
    columns: [
      "emails.dedup_key",
      "emails.message_id_header",
      "emails.content_hash",
      "emails.thread_key",
      "reply_requests.thread_key",
      "sent_emails.dedup_key",
      "sent_emails.message_id",
      "sent_emails.parent_message_id",
      "sent_emails.thread_key",
    ],
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "ai-results",
    label: { en: "AI texts", pl: "Teksty AI" },
    purpose: {
      en: "The AI's reasons, extracted fields and summaries, the draft texts that the system builds from them, and error text",
      pl: "Uzasadnienia, wyciągnięte pola i podsumowania AI, szkice budowane z nich przez system oraz tekst błędów",
    },
    columns: ["triage_results.reason", "triage_results.fields", "actions.payload", "actions.last_error"],
    subjects: ["users", "others"],
    kept: { kind: "days", days: 90 },
  },
  {
    id: "triage-verdicts",
    label: { en: "Triage verdicts", pl: "Werdykty sortowania" },
    purpose: {
      en: "The category, confidence and reason code of each triaged mail, with model and prompt version",
      pl: "Kategoria, pewność i kod powodu każdej posortowanej wiadomości, z modelem i wersją promptu",
    },
    columns: [
      "triage_results.category",
      "triage_results.vip",
      "triage_results.confidence",
      "triage_results.reason_code",
      "triage_results.suspicious_reasons",
      "triage_results.model",
      "triage_results.prompt_version",
    ],
    subjects: ["others"],
    kept: untilMailbox,
  },
  {
    id: "action-records",
    label: { en: "Action records", pl: "Zapisy działań" },
    purpose: {
      en: "What the system did to a mail, who approved it and the answer of the mail provider",
      pl: "Co system zrobił z wiadomością, kto to zatwierdził i odpowiedź dostawcy poczty",
    },
    columns: [
      "actions.provider_result",
      "actions.status_reason",
      "actions.outgoing_message_id",
      "actions.approved_by",
      "actions.approved_via",
    ],
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "delegation",
    label: { en: "Delegated tasks", pl: "Delegowane zadania" },
    purpose: {
      en: "The task text that the owner sends to a delegate",
      pl: "Treść zadania, które właściciel wysyła wykonawcy",
    },
    columns: ["delegations.task_summary"],
    subjects: ["users", "others"],
    kept: { kind: "daysAfterClose", days: 90 },
  },
  {
    id: "rules",
    label: { en: "Delegates and sender rules", pl: "Wykonawcy i reguły nadawców" },
    purpose: {
      en: "The delegates (name, address, competence) and the sender rules that the owner sets",
      pl: "Wykonawcy (imię i nazwisko, adres, kompetencje) i reguły nadawców ustawione przez właściciela",
    },
    columns: ["delegates.*", "sender_rules.*"],
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "loop-texts",
    label: { en: "Open-loop texts", pl: "Teksty otwartych spraw" },
    purpose: {
      en: "Who you wait for or owe an answer, the short ask or promise, the subject and the addresses",
      pl: "Na kogo czekasz lub komu jesteś winien odpowiedź, krótki opis prośby lub obietnicy, temat i adresy",
    },
    columns: [
      "open_loops.subject",
      "open_loops.text",
      "open_loops.counterpart",
      "open_loops.to_addresses",
      "open_loops.cc_addresses",
    ],
    subjects: ["users", "others"],
    kept: { kind: "daysAfterClose", days: 90 },
  },
  {
    id: "reply-texts",
    label: { en: "Reply draft requests", pl: "Prośby o szkice odpowiedzi" },
    purpose: {
      en: "The short instruction that you give for a reply draft, and the sample drafts that the AI writes to show its style",
      pl: "Krótka wskazówka, którą podajesz do szkicu odpowiedzi, i przykładowe szkice, które AI pisze, by pokazać swój styl",
    },
    columns: ["reply_requests.instruction", "reply_requests.sample_body"],
    subjects: ["users", "others"],
    // The text period of the retention job (`RETENTION_TEXT_DAYS`, the same for every organization), counted from `reply_requests.created_at`
    // (`clearReplyTexts`, `docs/architecture.md` §7). `legal-retention.test.ts` ties the number and the column to the job and the papers.
    kept: { kind: "days", days: 90 },
  },
  {
    id: "mailbox-profile",
    label: { en: "Mailbox writing profile", pl: "Profil pisania skrzynki" },
    purpose: {
      en: "The name, the signature and the writing style that you set for a mailbox, used in the drafts that the AI writes",
      pl: "Imię i nazwisko, podpis i styl pisania ustawione dla skrzynki, używane w szkicach pisanych przez AI",
    },
    columns: ["mailbox_profiles.*"],
    // A signature can name a colleague or a contact: the DSR address map covers these columns (`address-map.ts`).
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "unsubscribe-data",
    label: { en: "Unsubscribe requests", pl: "Prośby o wypisanie z list" },
    purpose: {
      en: "The address and the domain of a mailing-list sender that you asked to unsubscribe from, and the result of the request",
      pl: "Adres i domena nadawcy listy mailingowej, z której poprosiłeś o wypisanie, oraz wynik tej prośby",
    },
    columns: ["unsubscribe_requests.*"],
    // The sender is a third party. A data-request erase of the sender deletes the row (`address-map.ts`, rule `delete`).
    // The member is a subject too: the row tells that the mailbox of a member left a list.
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "sender-context",
    label: { en: "Sender profiles", pl: "Profile nadawców" },
    purpose: {
      en: "Counts about each sender and recipient of a mailbox (mails, answers, reply times) under a keyed hash instead of the address, and the rule suggestions that the assistant makes from them",
      pl: "Liczby o każdym nadawcy i adresacie skrzynki (wiadomości, odpowiedzi, czasy odpowiedzi) pod skrótem z kluczem zamiast adresu oraz podpowiedzi reguł, które asystent z nich tworzy",
    },
    columns: ["sender_profiles.*", "sender_suggestions.*"],
    // A profile row holds no address, name or mail text: only the keyed hash, dates and counts. An open suggestion holds the
    // address or domain it names (`sender_suggestions.pattern`, cleared when the suggestion ends). The people are third
    // parties. The period is the longest one: a profile goes 365 days after its last activity, an ended suggestion 90 days
    // after its end (`deleteOldProfiles` and `deleteEndedSuggestions` in `modules/contacts/privacy.ts`, run by the daily retention job).
    subjects: ["others"],
    kept: { kind: "days", days: 365 },
  },
  {
    id: "chat-links",
    label: { en: "Chat links", pl: "Powiązania z czatem" },
    purpose: {
      en: "The Telegram chat that a member linked to receive notices",
      pl: "Czat Telegrama, który członek powiązał, aby dostawać powiadomienia",
    },
    columns: ["chat_links.*"],
    subjects: ["users"],
    kept: untilMember,
  },
  {
    id: "push-devices",
    label: { en: "Notice devices", pl: "Urządzenia powiadomień" },
    purpose: {
      en: "The phone or the browser that a member registered to receive push notices: an encrypted address of the push service with its keys, a name of the device and the result of the last send",
      pl: "Telefon lub przeglądarka, które członek zarejestrował do powiadomień push: zaszyfrowany adres usługi push z kluczami, nazwa urządzenia i wynik ostatniej wysyłki",
    },
    columns: ["push_subscriptions.*"],
    // The device is bound to a web session: the end of the session makes it inactive, and the member can remove it in the
    // panel. No retention job clears the row: it goes with the member, the user or the organization.
    subjects: ["users"],
    kept: untilMember,
  },
  {
    id: "messages",
    label: { en: "Messages to members", pl: "Wiadomości do członków" },
    purpose: {
      en: "The notices, digests and approval cards that the system sends to a member",
      pl: "Powiadomienia, zestawienia i karty zatwierdzeń, które system wysyła do członka",
    },
    columns: ["outbox.text", "outbox.view"],
    subjects: ["users", "others"],
    kept: { kind: "days", days: 90 },
  },
  {
    id: "audit",
    label: { en: "Audit trail", pl: "Dziennik audytu" },
    purpose: {
      en: "Who decided what and when: system events, approvals and feedback on verdicts",
      pl: "Kto co i kiedy zdecydował: zdarzenia systemu, zatwierdzenia i opinie o werdyktach",
    },
    columns: ["audit_log.*", "triage_feedback.*", "action_feedback.*"],
    subjects: ["users", "others"],
    kept: untilMailbox,
  },
  {
    id: "tombstones",
    label: { en: "Erase tombstones", pl: "Znaczniki usunięcia" },
    purpose: {
      en: "The hash of a message identifier, so an erased mail does not come back at the next sync",
      pl: "Skrót identyfikatora wiadomości, aby usunięta wiadomość nie wróciła przy następnej synchronizacji",
    },
    columns: ["dsr_tombstones.*"],
    subjects: ["others"],
    kept: untilMailbox,
  },
];

// Tables of codes, counts, flags or migrations only: no text, no address, no name. Each has its reason.
export const NO_PERSONAL_DATA_TABLES: Readonly<Record<string, string>> = {
  schema_migrations: "migration versions only",
  ops_alerts: "a kind code and numeric facts; no organization",
  org_features: "a flag name and an on/off value",
  digests: "the slot key (a date and a code) and times",
  email_flags: "flags and times of a mail; no text",
  sent_analyses: "status codes and two flags per sent mail",
  history_checks: "status codes, evidence keys, counts and costs",
  history_check_items: "a category, a reason code, a confidence and a cost per mail",
  autonomy_trips: "a category, a reason code and counts",
};

/** The category that holds `table.column`, by name or by `table.*`; undefined when no category lists it. */
export function categoryOfColumn(table: string, column: string): DataCategory | undefined {
  return dataCategories.find(
    (category) => category.columns.includes(`${table}.${column}`) || category.columns.includes(`${table}.*`)
  );
}

/** The table of a `columns` entry. */
export function tableOfEntry(entry: string): string {
  return entry.slice(0, entry.indexOf("."));
}
