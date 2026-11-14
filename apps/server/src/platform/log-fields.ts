/** Field names a log line may carry after its base keys (ADR 0024). Add a name in the change that first logs it; the review checks that its values are ids, codes, counts or times. */
export const logFieldNames = [
  // ids
  "org_id",
  "mailbox_id",
  "email_id",
  "action_id",
  "delegation_id",
  "outbox_id",
  "user_id",
  // context (stage 02 sets them from AsyncLocalStorage)
  "job",
  "run_id",
  "request_id",
  // counts and times
  "count",
  "attempts",
  "ms",
  "tokens_in",
  "tokens_out",
  "mailbox_count",
  "org_count",
  "suspended_count",
  "port",
  "minutes",
  // send limits
  "mailbox_hour",
  "mailbox_day",
  "recipient_day",
  // codes
  "code",
  "error",
  "error_code",
  "kind",
  "status",
  "reason",
  "scope",
  "folder_key",
  "provider",
  "model",
  "role",
  "method",
  "route",
  "config_key",
  "flag",
  "release",
] as const;

export type LogFieldName = (typeof logFieldNames)[number];
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Partial<Record<LogFieldName, LogValue>>>;

export const EVENT_CODE = /^[a-z][a-z0-9_]{0,63}$/;

const fieldNameSet: ReadonlySet<string> = new Set(logFieldNames);
const VALUE_STRING = /^[A-Za-z0-9_.:/*-]{0,64}$/;

/** D7: a finite number, a boolean, null, or a string of 0–64 characters from [A-Za-z0-9_.:/*-] without "://". No space, no "@", no URL. */
export function isLogValue(value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" && VALUE_STRING.test(value) && !value.includes("://");
}

export function isLogFieldName(name: string): name is LogFieldName {
  return fieldNameSet.has(name);
}
