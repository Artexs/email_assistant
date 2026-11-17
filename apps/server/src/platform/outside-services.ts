// Which config key names an outside endpoint or credential, and the sub-processor row it belongs to (ticket F107).
//
// `subprocessors` (`@ea/core`) lists the outside services that get data. A test reads every key of the config schema
// that ends in `_URL`, `_HOST`, `_API_KEY`, `_TOKEN` or `_ENDPOINT` and fails for a key that is not here: a new outside
// service needs a row and a decision before it ships. A string value is a sub-processor id; `{ exempt }` says why the
// key names no outside service.
export const OUTSIDE_SERVICE_KEYS: Readonly<Record<string, string | { exempt: string }>> = {
  DATABASE_URL: { exempt: "the own database of this install" },
  HEARTBEAT_URL: "healthchecks",
  GEMINI_API_KEY: "gemini",
  TELEGRAM_BOT_TOKEN: "telegram",
  OPENAI_API_KEY: "openai",
  OPENAI_OWN_API_KEY: { exempt: "the key of an LLM server that the operator runs; it never reaches OpenAI" },
  OPENAI_BASE_URL: "openai",
  WEB_BASE_URL: { exempt: "the own panel URL of this install" },
  AUTH_SMTP_HOST: "auth-smtp",
};
