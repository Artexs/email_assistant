# F103 stage 11 — Lint error everywhere; the old form removed; docs

Part of [`../plan.md`](../plan.md). Needs stages 01–10 landed.

Three steps.

## Step 1 — One `error` block and the `.message` selector

**Goal.** An old-form log line anywhere in `apps/server/src` fails the lint, and so does a field that reads `.message` (D8).

**Files.** `eslint.config.js`, `apps/server/src/platform/log-lint.test.ts`.

**Interfaces.**
- Remove the `warn` block (comment "The modules convert in E8a …") and the per-folder `error` block. Add one block: `files: ["apps/server/src/**/*.ts"]`, `ignores: ["**/*.test.ts"]`, `rules: { "no-restricted-syntax": ["error", ...logEventSelectors] }`, comment: "Log lines are events (ADR 0024, docs/code-patterns.md § Logs). Tests call invalid forms on purpose (platform/log.test.ts)."
- Add to `logEventSelectors`: `{ selector: \`${logCall} > ObjectExpression > Property > MemberExpression.value[property.name="message"]\`, message: \`${logEventMessage} Never error.message: use ...errorFields(error).\` }`. (Probe V9 of this plan: it flags `log.info("a", { reason: error.message })` and `mailboxLog.warn("b", { code: e.message })`, not `{ reason: error.name }`, `{ ...error }` or `{ message: "x" }`.)
- Before you change the config: run `bun run lint` and count the `no-restricted-syntax` warnings. If the count is not 0, convert those lines first by the rules of D5 (they come from other tickets, D16) and list them.

**Test** (`log-lint.test.ts`).
1. The cases of "log lint: old forms warn" (virtual folder `lint-fixture/`) now give `[2]`; rename the `describe` to "log lint: old forms fail".
2. The per-folder cases of stages 04–10 still give `[2]`; keep them.
3. New: `log.info("a", { reason: e.message });` (with `declare const e: Error;` in the header) gives `[2]`; `log.info("a", { reason: e.name });` gives `[]`.
4. The `.test.ts` cases still give `[]`.

**Check.** `bun test apps/server/src/platform/log-lint.test.ts`; `bun run lint` shows 0 `no-restricted-syntax` messages.

**Done when.** The cases pass; the lint is clean.

## Step 2 — Remove the old form from the writer and the type

**Goal.** The `Log` type has only the event signature; a call that is not in the event form (through a cast) writes no argument (D9).

**Files.** `apps/server/src/platform/log.ts`, `apps/server/src/platform/log.test.ts`, every file that the typecheck then flags.

**Interfaces.**

```ts
export interface Log {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  with(fields: LogFields): Log;
}
```

- `write`: when `isEventForm(args)` is false, write the event line `log_call_invalid` (`msg` the same) with the context fields only, count one drop (`droppedTotal += 1`, `dropped_fields: 1` on the line), in both formats. No argument of the call reaches the line. Remove the `legacy_text` path and the `format` import.
- `makeLog` keeps `(...args: unknown[])` internally; only the exported type narrows.
- The typecheck now checks field names and kinds at each call (V10: a wrong kind or an unknown name in an object literal is an error; a spread is checked only when it shares no property). Fix each flagged call by the D1 kinds (convert a value, rename a field, or add a name to its kind list with a reason in the final message). Never widen a kind.

**Test** (`log.test.ts`).
1. The old-form cases (`the old form in text prints as before`, `the old form in JSON is one legacy_text line`, `the old form in JSON carries the context`, `the old form in text stays unchanged, with no context`, `a call writes one line, also with a newline in an old-form argument`) become: a call through `const raw = log as unknown as { info: (...args: unknown[]) => void }` with `raw.info("free text MARKER", { org_id: O })` writes one `log_call_invalid` line with `dropped_fields: 1`, in JSON and in text, and no line holds `MARKER` or `free text`; inside `withLogContext({ run_id: R })` the line carries `run_id`.
2. A type test: `// @ts-expect-error a string in a number field` above `log.info("x", { count: "a" });` and `// @ts-expect-error an unknown field` above `log.info("x", { subject: "a" });` (`bun run typecheck` fails if either line compiles). Wrap them in a function that the test never calls.
3. All other cases of `log.test.ts` pass.

**Check.** `bun run typecheck`; `bun test apps/server/src/platform/log.test.ts`.

**Done when.** Typecheck and the cases pass; `grep -n "legacy_text\|@deprecated" apps/server/src/platform/log.ts` prints nothing.

## Step 3 — Docs

**Files and text.**
- `docs/code-patterns.md` § Logs: rewrite the bullets for the final state: the field kinds (`uuidFieldNames`, `numberFieldNames`, `codeFieldNames`; a value must fit its kind; a new number name is free, a new UUID or code name needs a closed value set, D2); errors (`errorFields`, `telegramErrorFields`; never `.message`, the lint fails on it); the lint fails on any other form in `apps/server/src`; CLI output (`createCliOutput`, scripts only, always text, may print what the operator asked for; `error.message` only in the mail-connection scripts of D4); a Telegram update has its own `run_id`. Remove the sentences about the warn level and "E8a converts the modules". § Style: change "Other errors: `errorFields(error)` in an event line, `describeError(error)` only in an old-form line that E8a has not converted yet" to "Other errors: `errorFields(error)` in a log line; `describeError(error)` only in CLI output and DB error texts."
- `.agents/limen/styleguide.md` line 26: drop "For Telegram errors in an old-form line only `telegramErrorLabel(error)`"; add "Telegram errors: `...telegramErrorFields(error)`. CLI scripts print through `createCliOutput`." Line 46 stays.
- `docs/architecture.md` "**Logs:**" line (§ Security): "Log lines are events with allow-listed fields of three kinds (UUID, number, code); the lint fails on any other form and the canary test proves no mail string reaches a log (`docs/capabilities/logs.md`, ADR 0024)." (The canary lands in stage 12; it is planned, so the sentence is true after stage 12. Write it now.)
- `docs/capabilities/logs.md` (new; if stage 14 has created it already, add the logger part to it and keep its store part) by the template of `docs/capabilities/README.md` (sections What it does now, Rules, Entry points, Data, Limits, Decisions), "Checked against" the commit of this stage. Rules: the event form, the kinds, the context (`runJobTick`, the request id, the Telegram update), the formats (`LOG_FORMAT`), the CLI output. Entry points: function `createLog` (`apps/server/src/platform/log.ts`), function `withLogContext`, function `createCliOutput` (`apps/server/src/platform/cli.ts`), function `errorFields` (`apps/server/src/platform/errors.ts`). Limits: "The log store and its search come with F103 stages 14–15." Decisions: ADR 0024. Add its row to the index of `docs/capabilities/README.md`.
- ADR 0024 "Progress" line: "F103 (`spec/features/active/F103-e8a-logs/`) converted every module and script line, holds `apps/server/src` at lint error and split the fields into kinds."

**Check.** `bun test apps/server/src/capability-map.test.ts`; `bunx prettier --check <the changed docs>`.

**Done when.** The capability-map test passes; the Proof of `plan.md` (`/tmp/f103-s11`) prints `PROOF_OK`; `lint.log` holds 0 `no-restricted-syntax` messages (the final message says so: the coordinator removes the backlog sentence from `spec/build.md`).

**Out of scope.** The canary test (stage 12); the store docs (stage 14).
