# F089 stage 04 — The lint rule in `warn`, with a fixture test

Part of [`../plan.md`](../plan.md). Read D4, D18 and "Facts checked" P3, P4 of `plan.md` first. Needs stage 01 landed and F086 in `done/` (this stage adds a block next to F086's border block in `eslint.config.js`). May build at the same time as stage 02 or 03 (no shared file). Two steps.

## Step 1 — The rule

**Goal.** `bun run lint` warns on every server log call that is not in the event form, and says how to write it.

**Files.** Change: `eslint.config.js`.

**Interfaces.** Below the SDK import constants (`grammyImports`, …, `restrictImports`), add:

```js
// Log lines are events (ADR 0024, docs/code-patterns.md § Logs). This is the only no-restricted-syntax rule for
// server files: flat config replaces the options of a rule, so a second block with this rule would drop these selectors.
const logCall =
  'CallExpression[callee.type="MemberExpression"][callee.object.name=/^(log|[a-z][A-Za-z0-9]*Log)$/][callee.property.name=/^(debug|info|warn|error)$/]';
const logEventMessage =
  'Log lines are events: log.<level>("event_code", { allow-listed fields }) (ADR 0024, docs/code-patterns.md § Logs).';
const logEventSelectors = [
  { selector: `${logCall} > :first-child:not(Literal[value=/^[a-z][a-z0-9_]{0,63}$/])`, message: logEventMessage },
  { selector: `${logCall}[arguments.length>2]`, message: `${logEventMessage} At most two arguments.` },
  { selector: `${logCall}[arguments.length=0]`, message: `${logEventMessage} The event code is missing.` },
];
```

In the `export default tseslint.config(…)` list, after the block of F086 that holds `import/no-restricted-paths` (or, if F086 put it elsewhere, after `nodeConfig,`), add:

```js
  {
    // The modules convert in E8a; then each converted folder moves to the error block (D18).
    // Tests call the old form on purpose (platform/log.test.ts).
    files: ["apps/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": ["warn", ...logEventSelectors] },
  },
```

Before you add it, check that no other block sets `no-restricted-syntax`: `grep -n "no-restricted-syntax" eslint.config.js` prints only your lines. If another block has it, stop and report it (a gap).

**Decisions.** D4 widened by D18 (the first argument must be an event code literal, not only "no template"), P3, P4.

**Test.** Step 2.

**Check.**

```
mkdir -p /tmp/f089-s04 && bun run lint > /tmp/f089-s04/lint-step1.log 2>&1; echo "exit $?"
grep -c "no-restricted-syntax" /tmp/f089-s04/lint-step1.log
grep -E "problems? \(" /tmp/f089-s04/lint-step1.log
```

The exit is `0`. The first count is the backlog: 427 on the code of 2026-11-13, minus 2 when stage 03 has landed (the scheduler lines), plus the lines that later tickets added. The summary line shows `0 errors`. Write the count and the summary line in the final message.

**Done when.** The lint exits 0 and shows the warnings; no other block sets the rule.

**Out of scope.** The `error` block for converted files (stage 06). Fixing any warning.

## Step 2 — The fixture test

**Goal.** A unit test proves that the rule warns on the old forms and passes the event form, with the real `eslint.config.js`.

**Files.** New: `apps/server/src/platform/log-lint.test.ts` (in `bun run test:unit`).

**Interfaces.** The pattern of F086's `apps/server/src/modules/borders.test.ts` (virtual files, ESLint's Node API, nothing written to disk):

```ts
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

const header =
  'import { createLog } from "../../platform/log";\n\nconst log = createLog("mail");\nconst mailboxLog = log.with({});\ndeclare const id: string, e: unknown, a: unknown, b: unknown, y: string;\n';

/** Severities of the log-event messages for `line` in a virtual file. */
async function logEventSeverities(file: string, line: string): Promise<number[]> {
  const [result] = await eslint.lintText(`${header}${line}\n`, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter(
      (message) => message.ruleId === "no-restricted-syntax" && message.message.startsWith("Log lines are events")
    )
    .map((message) => message.severity);
}
```

Each case is a `test(…, 30_000)` (the first `lintText` loads the config). The virtual file is `apps/server/src/modules/mail/__log-fixture.ts` unless the case says another; it does not exist on disk.

**Test.**

| #   | Line                                                                                     | Expected severities      |
| --- | ---------------------------------------------------------------------------------------- | ------------------------ |
| 1   | ``log.info(`sync ${id} done`);``                                                         | `[1]`                    |
| 2   | `log.info("sync done");`                                                                 | `[1]`                    |
| 3   | `log.info("sync ${id}");` (a plain string with `${`)                                     | `[1]`                    |
| 4   | `log.error("config error:", e);`                                                         | `[1]`                    |
| 5   | `log.warn("ping_failed", a, b);`                                                         | `[1]`                    |
| 6   | ``mailboxLog.info(`x ${y}`);``                                                           | `[1]`                    |
| 7   | `log.info();`                                                                            | `[1]`                    |
| 8   | `log.info("sync_done", { mailbox_id: id });`                                             | `[]`                     |
| 9   | `log.info("sync_done");`                                                                 | `[]`                     |
| 10  | `mailboxLog.debug("sync_done", {});`                                                     | `[]`                     |
| 11  | ``console.info(`x ${y}`);``                                                              | `[]`                     |
| 12  | ``log.info(`sync ${id} done`);`` in `apps/server/src/modules/mail/__log-fixture.test.ts` | `[]` (tests are ignored) |

Group 1–7 as `describe("log lint: old forms warn", …)` and 8–12 as `describe("log lint: event form passes", …)`. Name each test by what it proves, for example "a template literal warns".

**Check.** `bun test apps/server/src/platform/log-lint.test.ts` passes: 12 tests.

Mutation check, then revert: in `eslint.config.js`, change `"warn"` of the new block to `"off"`; cases 1–7 fail. Restore it (`git diff eslint.config.js` shows only the stage's lines).

**Done when.** 12 tests pass; the mutation check failed and is reverted.

**Out of scope.** The `error` cases for `platform/` and `main.ts` (stage 06 adds them to this file).

## Stage done when

- Steps 1 and 2 are done; the final message gives the two counts of step 1.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `04`).
