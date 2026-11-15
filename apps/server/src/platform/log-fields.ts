/** Field names a log line may carry after its base keys (ADR 0024). Add a name in the change that first logs it; the review checks that its values are ids, codes, counts or times. */
/** UUID fields: a lower-case UUID or null (D1). */
export const uuidFieldNames = [
  "org_id",
  "mailbox_id",
  "email_id",
  "action_id",
  "delegation_id",
  "outbox_id",
  "user_id",
  "run_id",
  "request_id",
] as const;
/** Number fields: a finite number or null. Counts and times (D1). */
export const numberFieldNames = [
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
  // outbox sender
  "wait_ms",
  // telegram
  "update_id",
  "bot_id",
] as const;
/** Code fields: the F089 D7 rule (D1, D2). Values come from closed sets, never from mail, users or outside text. */
export const codeFieldNames = [
  "job",
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
  // The LLM endpoint: a kind (standard, eu, own) and a hostname from the operator config, never a URL.
  "endpoint",
  "host",
  "role",
  "method",
  "route",
  "config_key",
  "flag",
  "release",
] as const;
/** All allowed field names (ADR 0024). Add a name to the list of its kind in the change that first logs it; the review checks its values. */
export const logFieldNames = [...uuidFieldNames, ...numberFieldNames, ...codeFieldNames] as const;

export type UuidFieldName = (typeof uuidFieldNames)[number];
export type NumberFieldName = (typeof numberFieldNames)[number];
export type CodeFieldName = (typeof codeFieldNames)[number];
export type LogFieldName = (typeof logFieldNames)[number];
export type LogFieldKind = "uuid" | "number" | "code";
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<
  Partial<
    Record<UuidFieldName, string | null> &
      Record<NumberFieldName, number | null> &
      Record<CodeFieldName, string | number | boolean | null>
  >
>;

export const EVENT_CODE = /^[a-z][a-z0-9_]{0,63}$/;

const fieldNameSet: ReadonlySet<string> = new Set(logFieldNames);
const uuidNameSet: ReadonlySet<string> = new Set(uuidFieldNames);
const numberNameSet: ReadonlySet<string> = new Set(numberFieldNames);
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

export function logFieldKind(name: string): LogFieldKind | undefined {
  if (uuidNameSet.has(name)) {
    return "uuid";
  }
  if (numberNameSet.has(name)) {
    return "number";
  }
  return fieldNameSet.has(name) ? "code" : undefined;
}

/** D1: uuid → lower-case UUID string or null; number → finite number or null; code → the D7 rule. */
export function isLogValueOfKind(kind: LogFieldKind, value: unknown): boolean {
  if (kind === "code") {
    return isLogValue(value);
  }
  if (value === null) {
    return true;
  }
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string" && UUID_VALUE.test(value);
}
