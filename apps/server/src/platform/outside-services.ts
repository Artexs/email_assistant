// Which config key names an outside endpoint or credential, and the sub-processor row it belongs to.
//
// `subprocessors` (`@ea/core`) lists the outside services that get data. A test reads every key of the config schema
// that ends in `_URL`, `_HOST`, `_API_KEY`, `_TOKEN`, `_ENDPOINT` or `_API_ROOT`, or starts with `MAIL_OAUTH_`, and fails
// for a key that is not here: a new outside service needs a row and a decision before it ships. A string value is a
// sub-processor id; `{ exempt }` says why the key names no outside service.
export const OUTSIDE_SERVICE_KEYS: Readonly<Record<string, string | { exempt: string }>> = {
  DATABASE_URL: { exempt: "the own database of this install" },
  HEARTBEAT_URL: "healthchecks",
  GEMINI_API_KEY: "gemini",
  TELEGRAM_BOT_TOKEN: "telegram",
  OPENAI_API_KEY: "openai",
  DEEPSEEK_API_KEY: {
    exempt: "dev, tests and evals only; config refuses LLM_PROVIDER=deepseek with TRIAGE_LLM_SCOPE=all (F141 P4)",
  },
  OPENAI_OWN_API_KEY: { exempt: "the key of an LLM server that the operator runs; it never reaches OpenAI" },
  OPENAI_BASE_URL: "openai",
  WEB_BASE_URL: { exempt: "the own panel URL of this install" },
  AUTH_SMTP_HOST: "auth-smtp",
  MAIL_OAUTH_MICROSOFT_CLIENT_ID: "microsoft-oauth",
  MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: "microsoft-oauth",
  MAIL_OAUTH_GOOGLE_CLIENT_ID: "google-oauth",
  MAIL_OAUTH_GOOGLE_CLIENT_SECRET: "google-oauth",
  VAPID_PUBLIC_KEY: {
    exempt: "the public half of the own Web Push identity of this install; it names no outside service (F118)",
  },
  // The secret half signs each push request; the row `web-push` is active when it is set.
  VAPID_PRIVATE_KEY: "web-push",
  VAPID_SUBJECT: "web-push",
  TELEGRAM_API_ROOT: {
    exempt: "dev only: a fake Bot API on a loopback address (the config schema refuses any other host)",
  },
};

// Outside calls that no config key names, because the host comes from mail text, and that are no sub-processor.
// A call here needs a reason that says what the other side receives, and the file that makes it. A test reads this list: a new class
// of outside call is a decision (a row in `subprocessors`, or an entry here with a reason), never a silent addition.
export const OUTSIDE_CALL_CLASSES: Readonly<Record<string, { file: string; call: string; exempt: string }>> = {
  unsubscribe_target: {
    file: "web-routers.ts",
    call: "postOneClick(",
    exempt:
      "the one-click unsubscribe request (RFC 8058) goes to the server that the newsletter itself names, after an owner tap, and only to a public https host on port 443; it holds the fixed body `List-Unsubscribe=One-Click` and no data of the mailbox, so the other side processes nothing for this service and is no sub-processor; it receives the address of this server, as a mail sender does when a recipient opens a link",
  },
};
