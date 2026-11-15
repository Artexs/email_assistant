# F103 stage 13 — Lint error everywhere; `no-console` at error; the old form removed; docs

Part of [`../plan.md`](../plan.md). Needs stages 01–12 landed.

Three steps.

## Step 1 — One `error` block and the `.message` selector

**Goal.** An old-form line or a `.message` field anywhere in `apps/server/src` fails the lint (D8).

**Interfaces** (`eslint.config.js`):

- First count the `no-restricted-syntax` warnings of `bun run lint`; not 0 → convert those lines by D5 (D16) and list them.
- Remove the `warn` block ("The modules convert in E8a …") and the per-folder `error` block. Add one block: `files: ["apps/server/src/**/*.ts"]`, `ignores: ["**/*.test.ts"]`, `rules: { "no-restricted-syntax": ["error", ...logEventSelectors], "no-console": "error" }`, comment "Log lines are events (ADR 0024, docs/code-patterns.md § Logs). Tests call invalid forms on purpose (platform/log.test.ts)."
- Add to `logEventSelectors`: ``{ selector: `${logCall} > ObjectExpression MemberExpression[property.name="message"]`, message: `${logEventMessage} Never error.message: use ...errorFields(error).` }`` (descendant form; V9 in `../plan-facts.md` lists the forms it flags and passes).
- `no-console` is `warn` in `baseConfig` (warnings do not fail, F089 P4); 0 warnings in `apps/server/src` at `560e74e7`. `platform/log.ts` and `platform/cli.ts` keep their disable comments. A newly found `console` call becomes an event or CLI output; list it. `process.stdout.write` stays (D26).

**Test** (`platform/log-lint.test.ts`).

1. The "old forms warn" cases (virtual folder `lint-fixture/`) now give `[2]`; rename the `describe` to "log lint: old forms fail".
2. The per-folder cases of stages 04–12 still give `[2]`.
3. With `declare const e: Error;` in the header: `log.info("a", { reason: e.message });` and `log.info("a", { reason: (e as Error).message });` give `[2]`; `log.info("a", { reason: e.name });` gives `[]`.
4. The `.test.ts` cases still give `[]`.
5. `console.log(y);` at `modules/mail/__log-fixture.ts` gives one `no-console` message, severity 2; in a `.test.ts` path, severity 1 or none.

**Done when.** The cases pass; `bun run lint` shows 0 `no-restricted-syntax` messages.

## Step 2 — Remove the old form from the writer and the type

**Goal.** `Log` has only the event signature; another call shape writes no argument (D9).

**Interface** (`platform/log.ts`):

```ts
export interface Log {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  with(fields: LogFields): Log;
}
```

- Another call shape writes `log_call_invalid` (`msg` the same), context fields only, `dropped_fields: 1`, one drop, both formats. The `legacy_text` path goes. The implementation may keep `(...args: unknown[])`.
- The typecheck now checks names and kinds (V10). Fix each flagged call by D1 (convert a value, rename a field, or add a name with a reason). Never widen a kind.

**Test** (`platform/log.test.ts`).

1. The old-form cases become: `const raw = log as unknown as { info: (...args: unknown[]) => void }`; `raw.info("free text MARKER", { org_id: O })` writes one `log_call_invalid` line, `dropped_fields: 1`, in JSON and text; no `MARKER` or `free text`; inside `withLogContext({ run_id: R })` it carries `run_id`.
2. Type test: `// @ts-expect-error` above `log.info("x", { count: "a" });` and above `log.info("x", { subject: "a" });`, in a function the test never calls.
3. All other cases pass.

**Done when.** Typecheck and the cases pass; `platform/log.ts` holds no `legacy_text` and no `@deprecated`.

## Step 3 — Docs (D18)

- `docs/code-patterns.md` § Logs: the final rules (kinds and D2; `errorFields`, `telegramErrorFields`, never `.message`; lint error in `apps/server/src`; CLI output by D3, D4, D26; the Telegram `run_id`). Remove the warn-level and "E8a converts" sentences. § Style: `describeError` only in CLI output and DB error texts.
- `.agents/limen/styleguide.md`: replace the old-form `telegramErrorLabel` rule with "Telegram errors: `...telegramErrorFields(error)`. CLI scripts print through `createCliOutput`."
- `docs/architecture.md` "**Logs:**" line: events with allow-listed fields of three kinds; the lint fails on any other form; the canary proves no mail string reaches a log (`docs/capabilities/logs.md`, ADR 0024).
- `docs/capabilities/logs.md` (new, or add the logger part if stage 18 made it), by the template of `docs/capabilities/README.md`, with its index row. Entry points: `createLog`, `withLogContext`, `createCliOutput`, `errorFields`. Limits: "The log store comes with F103 stages 18–19."
- ADR 0024 "Progress": "F103 converted every module and script line, holds `apps/server/src` at lint error and split the fields into kinds."

**Done when.** `capability-map.test.ts` and `prettier --check` pass; the Proof (`/tmp/f103-s13`) prints `PROOF_OK`; `lint.log` holds 0 `no-restricted-syntax` messages.

**Out of scope.** The guards (stage 14); the canary (15, 16); the store docs (18).

## Carry-over from stage 06 review (proven by a run)

- The lint selectors miss `log.error("x_failed", grammyError)`: a literal first argument and a second argument that is not an object literal passes the lint, and the deprecated `(...args: unknown[])` overload accepts it. At runtime `isEventForm` rejects the non-plain object and the legacy path prints the whole error (description, payload, stack; in text format every field). Close this: a selector for a second argument that is not an ObjectExpression, or remove the deprecated overload; add a lint test case.
- Other dodges that pass today: an alias of the logger (`const logger = log`), `log["error"](...)`, `log.with({}).error(...)`, a destructured `error`, and `{ error: err.message }` as a field value (only the runtime value rule stops a long text; a one-word description or a bare token passes it).
- `console.error(err)` is only a `no-console` warning: stage 14 must make it an error in the scoped folders.
- Do not set `DEBUG` (grammy debug output) on the VPS; say so in the deploy docs (stage 19).
