# F103 stage 01 — Field kinds

Part of [`../plan.md`](../plan.md). `[risky]`: the value check is the privacy guard of every log line. Review job before the land.

One step.

## Step 1 — Kind lists, a value check per kind, typed fields

**Goal.** Each allowed field name has a kind: `uuid`, `number` or `code`. The writer keeps a value only when it fits the kind of its name. `LogFields` is typed per kind (D1).

**Interfaces** (`apps/server/src/platform/log-fields.ts`; `platform/log.ts` uses the check and changes nothing else):

```ts
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
  "mailbox_hour",
  "mailbox_day",
  "recipient_day",
] as const;
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
  "role",
  "method",
  "route",
  "config_key",
  "flag",
  "release",
] as const;
/** All allowed names (kept for callers and tests). */
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

export const EVENT_CODE = /^[a-z][a-z0-9_]{0,63}$/; // unchanged
export function logFieldKind(name: string): LogFieldKind | undefined;
/** uuid → UUID string or null; number → finite number or null; code → the F089 D7 rule. */
export function isLogValueOfKind(kind: LogFieldKind, value: unknown): boolean;
export function isLogFieldName(name: string): name is LogFieldName; // unchanged
export function isLogValue(value: unknown): value is string | number | boolean | null; // unchanged: the code rule
```

- The lists above hold every name of `log-fields.ts` at `560e74e7`. A name that another ticket adds before this stage builds goes to the list of its kind (a count or a time → number); list it in the final message.
- UUID rule: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, lower case only (Postgres, `randomUUID()`, the F089 request-id rule and Better Auth's `generateId: "uuid"` give lower case).
- The writer keeps a field when its name has a kind, the value fits the kind, and the key is not on the line yet. Order, drop count, context, child and text form stay as they are.
- A name is in one list only.

**Decisions.** D1, D2. F089 D7 (the code rule), D8 (key order, drops), D19 (no field named `key`, `token`, `secret`, `password`).

**Fixtures.** A test that logs a non-UUID id (for example `"org-1"` in `platform/http.test.ts`) gets a UUID fixture, never a looser rule. Find them with the full unit and integration runs; name each changed case in the final message.

**Test** (`platform/log.test.ts`, JSON format, `M` and `O` are UUID constants):

1. `{ mailbox_id: M }` is kept; `{ mailbox_id: "m1" }`, `{ mailbox_id: M.toUpperCase() }`, `{ mailbox_id: 7 }`, `{ mailbox_id: true }` are each dropped with `dropped_fields: 1`.
2. `{ count: 3 }`, `{ count: 0 }`, `{ count: null }` are kept; `{ count: "3" }`, `{ count: true }`, `{ count: Number.NaN }` are dropped.
3. `{ code: "http_503" }`, `{ code: 503 }`, `{ code: true }`, `{ code: null }` are kept; `{ code: "a b" }`, `{ code: "x@y.test" }`, `{ code: "https://x.test" }` are dropped (the F089 cases stay).
4. A context `run_id` that is not a UUID (`withLogContext({ run_id: "r1" }, …)`) is dropped and counted; a UUID `run_id` is kept.
5. `logFieldNames` equals the three lists joined; no name is in two lists; `logFieldKind("count")` is `"number"`, `logFieldKind("org_id")` is `"uuid"`, `logFieldKind("job")` is `"code"`, `logFieldKind("subject")` is `undefined`.
6. The existing cases pass (fixture changes only where a non-UUID id was logged).

**Done when.** The six cases pass; no other test fails; the Proof (`/tmp/f103-s01`) prints `PROOF_OK`. The final message lists every changed fixture and why.

**Out of scope.** Removing the old-form overload (stage 13). New field names (conversion stages). Call-site changes outside tests.
