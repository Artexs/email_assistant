# F103 stage 02 — CLI output

Part of [`../plan.md`](../plan.md). Review job before the land (the import border keeps CLI output out of server code). Needs stage 01 landed.

Three steps.

## Step 1 — `platform/cli.ts` and its import border

**Goal.** Scripts get an output helper that prints readable lines to the terminal and is not a log (D3).

**Interfaces.**

```ts
// apps/server/src/platform/cli.ts
/** Output of a CLI script for the operator's terminal. Not a log line: no LOG_FORMAT, no level, no allow-list (docs/code-patterns.md § Logs). Only apps/server/src/scripts/ imports it. */
export interface CliOutput {
  /** `[name] text` on stdout. */
  print(text: string): void;
  /** `[name] text` on stderr. */
  fail(text: string): void;
}
export function createCliOutput(name: string): CliOutput;
```

- `print` calls ``console.log(`[${name}]`, text)``, `fail` calls ``console.error(`[${name}]`, text)``, each with an `eslint-disable-next-line no-console` comment. Two arguments, so the joined text equals the old text form.
- Import border: `import/no-restricted-paths` zones in `borderZones()` of `eslint.config.js`, `from` = `platform/cli.ts`, one zone per target (`modules`, `platform`, the root `*.ts` files; the config comment forbids mixed `from` lists). Message: "Only scripts print CLI output (platform/cli.ts); other server code logs events (docs/code-patterns.md § Logs)." Tests are ignored by the borders block, so `cli.test.ts` may import it.
- `platform/log-lint.test.ts`: the "old forms warn" cases use a virtual path that no stage converts, `apps/server/src/lint-fixture/__log-fixture.ts` (import `"../platform/log"`); today they use `modules/mail/`, which stage 10 sets to error. Same for the `.test.ts` case.

**Decisions.** D3, D23.

**Test.**

1. `cli.test.ts`: with spies on `console.log` and `console.error`, `createCliOutput("rules").print("added rule 3")` calls `console.log` once with `("[rules]", "added rule 3")`; `fail("refused: x")` calls `console.error` once with `("[rules]", "refused: x")`.
2. `print` prints the same two arguments with `setLogLevel("error")` and with `setLogFormat("json")` (restore both).
3. `log-lint.test.ts`: `import { createCliOutput } from "../../platform/cli";\ncreateCliOutput("x").print("y");\n` at `apps/server/src/modules/mail/__cli-fixture.ts` gives one `import/no-restricted-paths` message; the same text at `apps/server/src/scripts/__cli-fixture.ts` (import `"../platform/cli"`) gives none.
4. The warn cases pass at the new fixture path.

**Done when.** The four cases pass.

## Step 2 — Convert 13 scripts (55 calls)

**Goal.** These scripts print through `createCliOutput`; none imports `createLog` after it.

**Files** (`apps/server/src/scripts/`, old-form calls at `560e74e7`): `delegates.ts` 3, `delegations.ts` 3, `digest-times.ts` 7, `e2e-activity.ts` 4, `e2e-seed.ts` 4, `job-run.ts` 5, `llm-check.ts` 4, `module-graph.ts` 2, `invite-delivery.ts` 5, `pick-member.ts` 2, `org-invite.ts` 6, `telegram-link.ts` 5, `web-invite.ts` 5. `invite-delivery.ts` and `pick-member.ts` take a logger parameter; it becomes `out: CliOutput`, and each caller passes its `out`.

**How to convert.**

- `const log = createLog("<name>")` → `const out = createCliOutput("<name>")`, same name.
- `debug` and `info` → `out.print`; `warn` and `error` → `out.fail`.
- The text is one string with the same characters: several arguments join with one space in a template literal. A non-string, non-number argument keeps its printed form through `format(x)` from `node:util`; list the line.
- `job-run.ts` keeps `withLogContext({ job, run_id }, …)` around the job: the job's module lines are logs. Only its own lines move.
- A `log.debug` line now always prints: list each one.
- Error text (D4): keep each existing print (`telegram-link.ts` and `web-invite.ts` print a `HardError` message of our own code); add no new `error.message`.

**Decisions.** D3, D4, D23.

**Test.** The CLI tests of these scripts pass unchanged: at least `org-invite-cli.test.ts`, `web-invite-cli.test.ts`, `tenancy-digest-times.test.ts`, `e2e-activity.test.ts`, `e2e-seed.test.ts`, `telegram-api-root.test.ts`, and every test that names one of these scripts. A test that must change means a printed text changed: stop and report it.

**Done when.** No `createLog` import in the 13 files; their tests pass.

## Step 3 — Docs line

`docs/code-patterns.md` § Logs, one bullet at the end: "CLI scripts (`apps/server/src/scripts/`) print to the operator's terminal through `createCliOutput(name)` (`platform/cli.ts`): `print` to stdout, `fail` to stderr, `[name] text`, always text. It is not a log line. Only scripts import it."

**Done when.** The bullet is there; the Proof (`/tmp/f103-s02`) prints `PROOF_OK`; the final message gives the warning count.

**Out of scope.** The other scripts (stages 03, 04). Module lines.
