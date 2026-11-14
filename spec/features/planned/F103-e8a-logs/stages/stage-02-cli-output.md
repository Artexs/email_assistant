# F103 stage 02 — CLI output

Part of [`../plan.md`](../plan.md). Review job before the land (the import border keeps CLI output out of server code).

Three steps. Needs stage 01 landed.

## Step 1 — `platform/cli.ts` and its import border

**Goal.** Scripts get an output helper that prints readable lines to the terminal and is not a log (D3).

**Files.**

- `apps/server/src/platform/cli.ts` (new)
- `apps/server/src/platform/cli.test.ts` (new)
- `eslint.config.js` (one zone in `borderZones()`)
- `apps/server/src/platform/log-lint.test.ts` (fixture path of the warn cases; one border case)

**Interfaces.**

```ts
// platform/cli.ts
/** Output of a CLI script for the operator's terminal. Not a log line: no LOG_FORMAT, no level, no allow-list (docs/code-patterns.md § Logs). Only apps/server/src/scripts/ imports it. */
export interface CliOutput {
  /** `[name] text` on stdout. */
  print(text: string): void;
  /** `[name] text` on stderr. */
  fail(text: string): void;
}
export function createCliOutput(name: string): CliOutput;
```

- `print` calls ``console.log(`[${name}]`, text)``, `fail` calls ``console.error(`[${name}]`, text)``, each with an `// eslint-disable-next-line no-console` comment (the only other `console` user is `platform/log.ts`). Two arguments, so the joined text is the same as the old text form (`console.log(prefix, ...args)`).
- Import border: in `borderZones()` of `eslint.config.js`, after the `packages` zone, push three zones with `` from: `${serverSrc}/platform/cli.ts` ``, message `"Only scripts print CLI output (platform/cli.ts); other server code logs events (docs/code-patterns.md § Logs)."`, and the targets `${serverSrc}/modules`, `${serverSrc}/platform` and `${serverSrc}/*.ts` (one zone each; the comment of the file says a `from` list must not mix globs and paths, so keep one target per zone too). Tests are ignored by the borders block, so `cli.test.ts` may import it.
- `log-lint.test.ts`: change `fixtureFile` (the warn cases, line 13) to `apps/server/src/lint-fixture/__log-fixture.ts` and the import path of those cases to `"../platform/log"`. That virtual folder is never converted, so the warn cases stay true until stage 13 flips them. Change the `.test.ts` case at line 121 the same way.

**Decisions.** D3, D23.

**Test.**

1. `cli.test.ts`: with spies on `console.log` and `console.error`, `createCliOutput("rules").print("added rule 3")` calls `console.log` once with `("[rules]", "added rule 3")`; `fail("refused: x")` calls `console.error` once with `("[rules]", "refused: x")`.
2. `print` prints with `setLogLevel("error")` and with `setLogFormat("json")` (restore both in `afterEach`): the same two arguments.
3. `log-lint.test.ts` new case: `lintText` of `import { createCliOutput } from "../../platform/cli";\ncreateCliOutput("x").print("y");\n` with `filePath` `apps/server/src/modules/mail/__cli-fixture.ts` gives one `import/no-restricted-paths` message; the same text for `apps/server/src/scripts/__cli-fixture.ts` with the import path `"../platform/cli"` gives none.
4. The existing warn cases pass with the new fixture path.

**Check.** `bun test apps/server/src/platform/cli.test.ts apps/server/src/platform/log-lint.test.ts`.

**Done when.** The four cases pass.

**Out of scope.** Converting a module line.

## Step 2 — Convert 13 scripts (55 calls)

**Goal.** These scripts print through `createCliOutput` and no longer import `createLog`.

**Files** (`apps/server/src/scripts/`; old-form calls at `0a5c2ee`): `delegates.ts` 3, `delegations.ts` 3, `digest-times.ts` 7, `e2e-activity.ts` 4, `e2e-seed.ts` 4, `job-run.ts` 5, `llm-check.ts` 4, `module-graph.ts` 2, `invite-delivery.ts` 5, `pick-member.ts` 2, `org-invite.ts` 6, `telegram-link.ts` 5, `web-invite.ts` 5. `invite-delivery.ts` and `pick-member.ts` take a logger parameter (`log: ReturnType<typeof createLog>`); its type becomes `out: CliOutput` and every caller in this list passes its `out`.

**How to convert.**

- `const log = createLog("<name>")` → `const out = createCliOutput("<name>")` with the same name.
- `log.debug(…)` and `log.info(…)` → `out.print(<text>)`; `log.warn(…)` and `log.error(…)` → `out.fail(<text>)`.
- `<text>` is one string that prints the same characters as before: one string argument stays; several arguments join with one space in a template literal (`log.error("failed:", describeError(error))` → ``out.fail(`failed: ${describeError(error)}`)``). A non-string argument other than a string or number: keep its old printed form with `format(x)` from `node:util` and list the line in the final message.
- `job-run.ts` keeps `withLogContext({ job, run_id }, …)` around the job: the job's module lines are logs. Only its own lines move to `out`.
- A `log.debug` line printed only under `LOG_LEVEL=debug` before; it now always prints. List such lines (none at `0a5c2ee`).
- Error text (D4): keep each existing print as it is, and add no new `error.message`. `telegram-link.ts:38` and `web-invite.ts:40` (`describeFailure`) print the message of a `HardError`; that stays (D23, same text). New error prints use `describeError` or `telegramErrorLabel`.

**Decisions.** D3, D4, D23.

**Test.** The CLI integration tests of these scripts pass unchanged: `org-invite-cli.test.ts`, `web-invite-cli.test.ts`, `tenancy-digest-times.test.ts`, `e2e-activity.test.ts`, `e2e-seed.test.ts`, `telegram-api-root.test.ts` and any other test that a grep for the script names in `apps/server/test` and `apps/server/src` finds. If a test must change, the stage has changed a printed text: stop and report it.

**Check.** `grep -n "createLog" <the 13 files>` prints nothing. `bun test apps/server/test/integration/org-invite-cli.test.ts apps/server/test/integration/web-invite-cli.test.ts apps/server/test/integration/tenancy-digest-times.test.ts`.

**Done when.** No `createLog` in the 13 files; their tests pass.

**Out of scope.** The other scripts (stages 03, 04).

## Step 3 — Docs line

**Goal.** A later worker knows the rule before stage 13 writes the full text.

**Files.** `docs/code-patterns.md` § Logs: one bullet at the end: "CLI scripts (`apps/server/src/scripts/`) print to the operator's terminal through `createCliOutput(name)` (`platform/cli.ts`): `print` to stdout, `fail` to stderr, `[name] text`, always text. It is not a log line. Only scripts import it."

**Check.** `bunx prettier --check docs/code-patterns.md`.

**Done when.** The bullet is there; the Proof of `plan.md` (`/tmp/f103-s02`) prints `PROOF_OK`; the final message gives the `no-restricted-syntax` warning count of `lint.log`.

**Out of scope.** The rest of the docs (stage 13).
