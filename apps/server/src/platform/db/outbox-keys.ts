import { sql, type RawBuilder } from "kysely";

// The dedup key of an outbox row of the channel `push`: the Telegram key of the event, this infix and the device id
// (`<key>:push:<device id>`). One row per device, so a retry never repeats to a device that got the notice.
export const PUSH_KEY_INFIX = ":push:";

export function pushDedupKey(key: string, subscriptionId: string): string {
  return `${key}${PUSH_KEY_INFIX}${subscriptionId}`;
}

// SQL: `column` holds `key` or a push row of the same event (`<key>:push:<device id>`). A reader that finds an event by its Telegram
// key uses this, so a push row counts as the event too. `starts_with`, not LIKE: a `_` or a `%` inside a key is no wildcard.
// `key` is a text or an SQL expression that gives the key (`'approval:' || a.id::text`).
export function dedupKeyOrPush(column: RawBuilder<string>, key: string | RawBuilder<string>): RawBuilder<boolean> {
  return sql<boolean>`(${column} = ${key}::text or starts_with(${column}, ${key}::text || ${PUSH_KEY_INFIX}::text))`;
}
