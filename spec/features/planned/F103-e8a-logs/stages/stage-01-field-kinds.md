# F103 stage 01 — Field kinds

Part of [`../plan.md`](../plan.md). `[risky]`: the value check is the privacy guard of every log line. Review job before the land.

One step.

## Step 1 — Kind lists, a value check per kind, typed fields

**Goal.** Each allowed field name has a kind: `uuid`, `number` or `code`. The writer keeps a value only when it fits the kind of its name. `LogFields` is typed per kind (D1).

**Files.**

- `apps/server/src/platform/log-fields.ts` (change)
- `apps/server/src/platform/log.ts` (change: use the kind check; nothing else)
- `apps/server/src/platform/log.test.ts` (change and add cases)
- Tests that log a non-UUID value in a UUID field (change the fixture value to a UUID): at least `apps/server/src/platform/http.test.ts` (`"u-multi"`, `"org-1"`, `"org-2"` reach the `membership` warning line through `user_id` and `org_id`). Find the rest with the full `test:unit:ci` and `test:int:ci` runs: a test that fails because a field is now dropped gets a UUID fixture, never a looser rule.

**Interfaces.**

```ts
// log-fields.ts
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
/** The value fits the kind: uuid → UUID string or null; number → finite number or null; code → the F089 D7 rule. */
export function isLogValueOfKind(kind: LogFieldKind, value: unknown): boolean;
export function isLogFieldName(name: string): name is LogFieldName; // unchanged
export function isLogValue(value: unknown): value is string | number | boolean | null; // unchanged: the code rule
```

- UUID rule: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (lower case only; Postgres, `randomUUID()` and the F089 request-id rule give lower case).
- In `log.ts` `addFields`: keep a field when `logFieldKind(key)` is defined, `isLogValueOfKind(kind, value)` holds, and the key is not on the line yet. Everything else stays as it is (order, drop count, context, child, text form).
- The three lists hold no name twice; a name is in one list only (a unit test checks it).

**Decisions.** D1, D2. F089 D7 (the code rule), D8 (key order, drops), D19 (no field named `key`, `token`, `secret`, `password`; this stays).

**Test** (`log.test.ts`, JSON format, `M` and `O` are the UUID constants of the file):

1. `{ mailbox_id: M }` is kept; `{ mailbox_id: "m1" }`, `{ mailbox_id: M.toUpperCase() }`, `{ mailbox_id: 7 }`, `{ mailbox_id: true }` are each dropped, `dropped_fields: 1`.
2. `{ count: 3 }`, `{ count: 0 }`, `{ count: null }` are kept; `{ count: "3" }`, `{ count: true }`, `{ count: Number.NaN }` are dropped.
3. `{ code: "http_503" }`, `{ code: 503 }`, `{ code: true }`, `{ code: null }` are kept; `{ code: "a b" }`, `{ code: "x@y.test" }`, `{ code: "https://x.test" }` are dropped (the F089 cases stay).
4. A context `run_id` that is not a UUID (`withLogContext({ run_id: "r1" }, …)`) is dropped and counted; a UUID `run_id` is kept.
5. `logFieldNames` equals the three lists joined; no name is in two lists; `logFieldKind("count")` is `"number"`, `logFieldKind("org_id")` is `"uuid"`, `logFieldKind("job")` is `"code"`, `logFieldKind("subject")` is `undefined`.
6. The existing cases of `log.test.ts` pass (change a fixture only where it logged a non-UUID id; name each changed case in the final message).

**Check.** `bun test apps/server/src/platform/log.test.ts apps/server/src/platform/http.test.ts`, then the Proof.

**Done when.** The six cases pass; no other test fails; `git diff --stat` shows only the files above and the changed test fixtures; the Proof of `plan.md` (stages 01–12, `/tmp/f103-s01`) prints `PROOF_OK`. The final message lists every test fixture that changed and why.

**Out of scope.** Removing the old-form overload (stage 11). New field names (the conversion stages). Any call-site change outside tests.
