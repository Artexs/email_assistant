import type { Texts } from "./texts";

// When a row is in use. The static legal pages do not follow a switch of the install, so each row shows this condition
// ("used when") instead of a claim that it is always used.
//   always       every install
//   llmProvider  any LLM role uses the provider (`LLM_PROVIDER`)
//   env          the key has a value that is not `unless`; a key with a default in the config schema counts as set
//   host         the home VPS runs the part (`backup`: `deploy/backup.sh`, no config key)
export type ActiveWhen =
  | { kind: "always" }
  | { kind: "llmProvider"; provider: string }
  | { kind: "env"; key: string; unless?: string }
  | { kind: "host"; part: "backup" };

// An outside service that gets data from this system. The privacy page, the DPA Annex 2, the records of processing and the
// security page of the web site read this list; a test ties it to the server config (`OUTSIDE_SERVICE_KEYS`).
export interface Subprocessor {
  id: string;
  /** A name or a placeholder such as `<SMTP provider>`. */
  name: string;
  purpose: Texts;
  /** What the service receives, in short. */
  dataReceived: Texts;
  /** Where the service processes the data: a sourced fact or a `<to confirm: …>` placeholder. */
  location: Texts;
  /** The provider's privacy page, or a `<to confirm: …>` placeholder. */
  termsUrl: string;
  /** false: the service gets no data about a person (a timing ping, a part of a hash). */
  personalData: boolean;
  activeWhen: ActiveWhen;
}

const toConfirmLocation: Texts = { en: "<to confirm: location>", pl: "<to confirm: location>" };

export const subprocessors: readonly Subprocessor[] = [
  {
    id: "openai",
    name: "OpenAI",
    purpose: {
      en: "AI model that sorts mail, writes drafts and finds open loops in own sent mail",
      pl: "Model AI, który sortuje pocztę, pisze szkice odpowiedzi i znajduje otwarte sprawy we własnej wysłanej poczcie",
    },
    dataReceived: {
      en: "for triage: mail text, subject, sender, To and Cc addresses, date, sender marks (whitelist, VIP, looks automatic), delegates and up to three earlier thread mails; for drafts: mail text, subject, sender, and for a reply draft also the display name, signature and writing style of the mailbox, the one line of instruction that the member typed and the time zone of the organization; for open loops: the subject, the local send time, the number of recipients and up to 8,000 characters of the text of own sent mail",
      pl: "do sortowania: treść, temat, nadawca, adresy Do i DW, data, oznaczenia nadawcy (biała lista, VIP, wygląda na automatyczny), wykonawcy i do trzech wcześniejszych wiadomości wątku; do szkiców: treść, temat, nadawca, a do szkicu odpowiedzi także nazwa wyświetlana, podpis i styl pisania skrzynki, jedna linia polecenia wpisana przez członka organizacji i strefa czasowa organizacji; do otwartych spraw: temat, lokalny czas wysłania, liczba adresatów i do 8000 znaków treści własnej wysłanej wiadomości",
    },
    location: {
      en: "No EU region is used (standard endpoint, ADR 0015). <to confirm: country>",
      pl: "Region UE nie jest używany (standardowy punkt końcowy, ADR 0015). <to confirm: country>",
    },
    termsUrl: "https://openai.com/policies/privacy-policy/",
    personalData: true,
    activeWhen: { kind: "llmProvider", provider: "openai" },
  },
  {
    id: "gemini",
    name: "Google Gemini API",
    purpose: {
      en: "AI model that sorts mail, writes drafts and finds open loops in own sent mail",
      pl: "Model AI, który sortuje pocztę, pisze szkice odpowiedzi i znajduje otwarte sprawy we własnej wysłanej poczcie",
    },
    dataReceived: {
      en: "for triage: mail text, subject, sender, To and Cc addresses, date, sender marks (whitelist, VIP, looks automatic), delegates and up to three earlier thread mails; for drafts: mail text, subject, sender; for open loops: the subject, the local send time, the number of recipients and up to 8,000 characters of the text of own sent mail",
      pl: "do sortowania: treść, temat, nadawca, adresy Do i DW, data, oznaczenia nadawcy (biała lista, VIP, wygląda na automatyczny), wykonawcy i do trzech wcześniejszych wiadomości wątku; do szkiców: treść, temat, nadawca; do otwartych spraw: temat, lokalny czas wysłania, liczba adresatów i do 8000 znaków treści własnej wysłanej wiadomości",
    },
    location: {
      en: "No EU location (docs/architecture.md §6). <to confirm: country>",
      pl: "Brak lokalizacji w UE (docs/architecture.md §6). <to confirm: country>",
    },
    termsUrl: "https://policies.google.com/privacy",
    personalData: true,
    activeWhen: { kind: "llmProvider", provider: "gemini" },
  },
  {
    id: "telegram",
    name: "Telegram",
    purpose: {
      en: "Chat channel for digests, notices and approvals",
      pl: "Kanał czatu dla zestawień, powiadomień i zatwierdzeń",
    },
    // The items of the consent text `tg_consent_text` (apps/web/src/i18n), no more, no less.
    dataReceived: {
      en: "the sender and subject of mails, the names (or file types) and sizes of their attachments, the AI's short reason or summary, the texts of drafts that wait for approval with the quoted part of the original mail, reply drafts that the AI writes for you, the Reply-To addresses of the original mail that a review card shows, and the addresses of the other recipients of a mail (To, Cc) when a reply goes to them, the names of delegates and the addresses of the mailboxes; with open loops: who you wait for, a short description of what you asked or promised, the due date, the subject of the mail, and follow-up drafts with their recipients",
      pl: "nadawca i temat wiadomości, nazwy (lub typy plików) i rozmiary ich załączników, krótkie uzasadnienie lub podsumowanie AI, treść szkiców czekających na zatwierdzenie wraz z cytowaną częścią oryginalnej wiadomości, szkice odpowiedzi, które AI pisze dla Ciebie, adresy Reply-To oryginalnej wiadomości, które pokazuje karta do przeglądu, oraz adresy pozostałych odbiorców wiadomości (Do, DW), gdy trafia do nich odpowiedź, imiona i nazwiska wykonawców oraz adresy skrzynek; przy otwartych sprawach: na kogo czekasz, krótki opis tego, o co prosisz lub co obiecujesz, termin, temat wiadomości oraz szkice przypomnień z ich adresatami",
    },
    location: {
      en: "Outside the EU; data can be processed outside the European Economic Area (consent text).",
      pl: "Poza UE; dane mogą być przetwarzane poza Europejskim Obszarem Gospodarczym (tekst zgody).",
    },
    termsUrl: "https://telegram.org/privacy",
    personalData: true,
    activeWhen: { kind: "env", key: "TELEGRAM_BOT_TOKEN" },
  },
  {
    id: "web-push",
    name: "Browser push services (Google FCM, Mozilla, Apple, Microsoft)",
    purpose: {
      en: "Deliver phone and browser notices",
      pl: "Dostarczanie powiadomień na telefon i do przeglądarki",
    },
    // What the push service of the browser of the device sees: the message is encrypted for the device (RFC 8291), and the
    // headers and the VAPID token (RFC 8292) are in clear text.
    dataReceived: {
      en: "an encrypted message (version, notice id, kind, count, item id, language) that they cannot read; the device push address; the time, size, lifetime (24 h), urgency (high or normal) and topic (a hash of the notice id) of each message; the operator contact in the signed VAPID token",
      pl: "zaszyfrowana wiadomość (wersja, identyfikator powiadomienia, rodzaj, liczba, identyfikator pozycji, język), której nie mogą odczytać; adres push urządzenia; czas, rozmiar, okres ważności (24 h), pilność (wysoka lub normalna) i temat (skrót identyfikatora powiadomienia) każdej wiadomości; kontakt operatora w podpisanym tokenie VAPID",
    },
    location: toConfirmLocation,
    termsUrl: "https://policies.google.com/privacy",
    personalData: true,
    activeWhen: { kind: "env", key: "VAPID_PRIVATE_KEY" },
  },
  {
    id: "backblaze",
    name: "Backblaze B2",
    purpose: {
      en: "Off-site storage of the nightly database backup",
      pl: "Zewnętrzne przechowywanie nocnej kopii zapasowej bazy danych",
    },
    dataReceived: {
      en: "the database dump, encrypted with age before upload",
      pl: "zrzut bazy danych, zaszyfrowany narzędziem age przed wysłaniem",
    },
    location: { en: "<B2 region>", pl: "<B2 region>" },
    termsUrl: "https://www.backblaze.com/company/policy/privacy",
    personalData: true,
    activeWhen: { kind: "host", part: "backup" },
  },
  {
    id: "tailscale",
    name: "Tailscale",
    purpose: {
      en: "Private network that gives members access to the panel",
      pl: "Sieć prywatna, przez którą członkowie mają dostęp do panelu",
    },
    dataReceived: {
      en: "panel traffic (encrypted), device and network metadata",
      pl: "ruch panelu (szyfrowany), metadane urządzeń i sieci",
    },
    location: toConfirmLocation,
    termsUrl: "https://tailscale.com/privacy-policy",
    personalData: true,
    activeWhen: { kind: "always" },
  },
  {
    id: "healthchecks",
    name: "Healthchecks.io",
    purpose: {
      en: "Alert when the server stops",
      pl: "Alert, gdy serwer przestaje działać",
    },
    dataReceived: { en: "a timing ping", pl: "ping czasowy" },
    location: toConfirmLocation,
    termsUrl: "https://healthchecks.io/privacy/",
    personalData: false,
    activeWhen: { kind: "env", key: "HEARTBEAT_URL" },
  },
  {
    id: "hibp",
    name: "Have I Been Pwned",
    purpose: {
      en: "Check of a new password against known leaks",
      pl: "Sprawdzenie nowego hasła w bazie znanych wycieków",
    },
    dataReceived: { en: "5 hex characters of a password hash", pl: "5 znaków szesnastkowych skrótu hasła" },
    location: toConfirmLocation,
    termsUrl: "https://haveibeenpwned.com/Privacy",
    personalData: false,
    activeWhen: { kind: "env", key: "AUTH_PWNED_CHECK", unless: "off" },
  },
  {
    id: "microsoft-oauth",
    name: "Microsoft (mailbox sign-in)",
    purpose: {
      en: "Sign-in to a Microsoft 365 mailbox with OAuth, instead of a password",
      pl: "Logowanie do skrzynki Microsoft 365 przez OAuth, zamiast hasłem",
    },
    dataReceived: {
      en: "the OAuth sign-in and token requests of the connection; the assistant then reads and sends mail of the mailbox through the provider",
      pl: "żądania logowania OAuth i tokenów przy połączeniu; asystent następnie czyta i wysyła pocztę ze skrzynki przez dostawcę",
    },
    location: toConfirmLocation,
    termsUrl: "https://privacy.microsoft.com/privacystatement",
    personalData: true,
    activeWhen: { kind: "env", key: "MAIL_OAUTH_MICROSOFT_CLIENT_ID" },
  },
  {
    id: "google-oauth",
    name: "Google (mailbox sign-in)",
    purpose: {
      en: "Sign-in to a Gmail mailbox with OAuth, instead of a password",
      pl: "Logowanie do skrzynki Gmail przez OAuth, zamiast hasłem",
    },
    dataReceived: {
      en: "the OAuth sign-in and token requests of the connection; the assistant then reads and sends mail of the mailbox through the provider",
      pl: "żądania logowania OAuth i tokenów przy połączeniu; asystent następnie czyta i wysyła pocztę ze skrzynki przez dostawcę",
    },
    location: toConfirmLocation,
    termsUrl: "https://policies.google.com/privacy",
    personalData: true,
    activeWhen: { kind: "env", key: "MAIL_OAUTH_GOOGLE_CLIENT_ID" },
  },
  {
    id: "auth-smtp",
    name: "<SMTP provider>",
    purpose: {
      en: "Delivery of sign-in mails (reset and invite links)",
      pl: "Dostarczanie wiadomości logowania (linki resetu i zaproszenia)",
    },
    dataReceived: {
      en: "the address and link of an auth mail",
      pl: "adres i link wiadomości uwierzytelniającej",
    },
    location: toConfirmLocation,
    termsUrl: "<to confirm: SMTP provider privacy page>",
    personalData: true,
    activeWhen: { kind: "env", key: "AUTH_SMTP_HOST" },
  },
];
