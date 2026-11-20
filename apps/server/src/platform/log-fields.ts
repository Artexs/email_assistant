/** Field names a log line may carry after its base keys (ADR 0024). Add a name in the change that first logs it; the review checks that its values are ids, codes, counts or times. */
/** UUID fields: a lower-case UUID or null. */
export const uuidFieldNames = [
  "org_id",
  "mailbox_id",
  "check_id",
  "email_id",
  "action_id",
  "delegation_id",
  "loop_id",
  "outbox_id",
  "approval_set_id",
  "item_id",
  "user_id",
  "run_id",
  "request_id",
  // reply drafts: the id of a reply request (`request_id` is the HTTP request context)
  "reply_request_id",
  // push devices (phone channel): the id of a push subscription; never its endpoint or keys
  "push_subscription_id",
] as const;
/** Number fields: a finite number or null. Counts and times. */
export const numberFieldNames = [
  "count",
  "attempts",
  "max_attempts",
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
  // outbox sender and testmail send
  "wait_ms",
  // push sender: the HTTP status that a push service answered (a number, never its text)
  "http_status",
  // mail sync: the time of one Sent pass
  "duration_ms",
  // sender profile pass: rows already equal (not written) and rows zeroed
  "unchanged",
  "zeroed",
  // retention job: rows cleared per kind
  "body_rows",
  "header_rows",
  "sent_body_rows",
  "sent_header_rows",
  "captured_header_rows",
  "triage_rows",
  "payload_rows",
  "error_rows",
  "task_rows",
  "outbox_rows",
  "loop_rows",
  "reply_text_rows",
  "token_rows",
  "profile_rows",
  "suggestion_rows",
  // telegram
  "update_id",
  "bot_id",
  // committer and expiry job
  "applied",
  "failed",
  "retry",
  "closed",
  "sent",
  "expired_timeout",
  "expired_draft_missing",
  "expired_not_notified",
  "expired_not_seen",
  "expired_held_timeout",
  // delegation chaser
  "due",
  "overdue",
  "reminders",
  // loops: the Sent analysis (loops opened in a run)
  "opened",
  // mail sync, below-cursor check and delivery
  "fetched",
  "stored",
  "uid_updated",
  "returned",
  "relocated",
  "cross_copies",
  "move_in_flight",
  "skipped_own",
  "ignored_below_cursor",
  "folder_count",
  "checked",
  "copies",
  "limit",
  "moved",
  "in_inbox",
  "duplicates_removed",
  "synced",
  "not_found",
  "failed_runs",
  // history check result: acted-on mails, the share of `\Answered` mail in percent, the acted-on mails that a category would move
  "acted",
  "answered_pct",
  "info_moved",
  "notification_moved",
  "spam_moved",
  // re-gate run: the `auto` grants stamped for the running key, moved to it, and paused
  "stamped",
  "regranted",
  "paused",
] as const;
/** Code fields: the closed-set rule. Values come from closed sets, never from mail, users or outside text. */
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
  // digest slot key, chat command, plan names, the user or the CLI that made a change
  "slot",
  "command",
  "from_plan",
  "to_plan",
  "enabled",
  "actor",
  // who started a loop command: web, telegram or cli
  "via",
  // the sync mode of one folder run: initial, incremental or rescan
  "sync_mode",
  // actions: the action type (a closed set of six) and the stage of a failed send (`connect`, `login`, `envelope`, `content`, `compose`, `payload`, `unknown`)
  "action_type",
  "send_stage",
  // testmail send: the batch name
  "batch",
  // triage and testmail: a case id (corpus id such as inv-001; a value with a space is dropped), the category of a mail, the feedback flag of a return, and ISO times (`toISOString()`) of a pause or a quota day
  "case_id",
  "category",
  "feedback",
  "until",
  "day_start",
  // a gate file name (`classifier-…json`, from the image, never user text)
  "file",
  // history check result: the check hit its cost cap, and the outcome per moving category (pass, fail, inconclusive, no_result)
  "capped",
  "info_outcome",
  "notification_outcome",
  "spam_outcome",
  // re-gate run: `start` (once, before the workers) or `job` (every 5 minutes)
  "run",
  // the copy check before a send: `same`, `changed`, `missing` or `no_baseline`
  "result",
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

/** A finite number, a boolean, null, or a string of 0–64 characters from [A-Za-z0-9_.:/*-] without "://". No space, no "@", no URL. */
export function isLogValue(value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" && VALUE_STRING.test(value) && !value.includes("://");
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

/** Uuid → lower-case UUID string or null; number → finite number or null; code → the closed-set rule. */
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
