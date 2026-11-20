import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

const headerFor = (importPath: string) =>
  `import { createLog } from "${importPath}";\n\nconst log = createLog("mail");\nconst mailboxLog = log.with({});\ndeclare const id: string, e: unknown, a: unknown, b: unknown, y: string, err: Error, fields: Record<string, string>;\ndeclare function errorFields(error: unknown): Record<string, string>;\ndeclare function telegramErrorFields(error: unknown): Record<string, string>;\n`;

const TIMEOUT = 30_000;
const fixtureFile = "apps/server/src/lint-fixture/__log-fixture.ts";
const modFixture = "apps/server/src/modules/mail/__log-fixture.ts";

/** Severities of the log-event messages for `line` in a virtual file. */
async function logEventSeverities(file: string, line: string, importPath = "../../platform/log"): Promise<number[]> {
  const [result] = await eslint.lintText(`${headerFor(importPath)}${line}\n`, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter(
      (message) => message.ruleId === "no-restricted-syntax" && message.message.startsWith("Log lines are events")
    )
    .map((message) => message.severity);
}

describe("log lint: old forms fail", () => {
  test.each([
    ["a template literal fails", fixtureFile, "log.info(`sync ${id} done`);", [2]],
    ["free text fails", fixtureFile, 'log.info("sync done");', [2]],
    ["a plain string with ${ fails", fixtureFile, 'log.info("sync ${id}");', [2]],
    ["three arguments fail", fixtureFile, 'log.warn("ping_failed", a, b);', [2]],
    ["a child logger with a template literal fails", fixtureFile, "mailboxLog.info(`x ${y}`);", [2]],
    ["a call with no argument fails", fixtureFile, "log.info();", [2]],
  ] as [string, string, string, number[]][])(
    "%s",
    async (_name, file, line, severities) => {
      expect(await logEventSeverities(file, line)).toEqual(severities);
    },
    TIMEOUT
  );

  test(
    "a text with an error argument fails",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.error("config error:", e);')).toEqual([2, 2]);
    },
    TIMEOUT
  );

  test(
    "a member logger fails (this.log, o.mailboxLog), also on a chain",
    async () => {
      expect(
        await logEventSeverities(
          fixtureFile,
          "declare const o: { log: typeof log; mailboxLog: typeof log };\no.log.info(`x ${y}`);"
        )
      ).toEqual([2]);
      expect(
        await logEventSeverities(
          fixtureFile,
          "declare const o: { log: typeof log; mailboxLog: typeof log };\no.mailboxLog.warn(`x ${y}`);"
        )
      ).toEqual([2]);
      expect(
        await logEventSeverities(fixtureFile, "declare const o: { log: typeof log };\no.log.with({}).error(`x ${y}`);")
      ).toEqual([2]);
    },
    TIMEOUT
  );
});

describe("log lint: event form passes", () => {
  test.each([
    [
      "a member logger with an event code passes",
      'declare const o: { log: typeof log };\no.log.info("sync_done", { count: 1 });',
    ],
    ["an event code with fields passes", 'log.info("sync_done", { mailbox_id: id });'],
    ["an event code alone passes", 'log.info("sync_done");'],
    ["a child logger with an event code passes", 'mailboxLog.debug("sync_done", {});'],
    ["console calls are not log calls", "console.info(`x ${y}`);"],
  ] as [string, string][])(
    "%s",
    async (_name, line) => {
      expect(await logEventSeverities(fixtureFile, line)).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "test files are ignored",
    async () => {
      expect(
        await logEventSeverities("apps/server/src/lint-fixture/__log-fixture.test.ts", "log.info(`sync ${id} done`);")
      ).toEqual([]);
    },
    TIMEOUT
  );
});

describe("log lint: converted files fail", () => {
  test.each([
    [
      "a template literal in platform fails",
      "apps/server/src/platform/__log-fixture.ts",
      "./log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "a template literal in scripts fails",
      "apps/server/src/scripts/__log-fixture.ts",
      "../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in channels/sender.ts fails",
      "apps/server/src/modules/channels/sender.ts",
      "../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in channels/telegram/ fails",
      "apps/server/src/modules/channels/telegram/__log-fixture.ts",
      "../../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in another file of channels fails",
      "apps/server/src/modules/channels/__log-fixture.ts",
      "../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in channels/notices/ fails",
      "apps/server/src/modules/channels/notices/__log-fixture.ts",
      "../../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in delegation fails",
      "apps/server/src/modules/delegation/__log-fixture.ts",
      "../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in triage fails",
      "apps/server/src/modules/triage/__log-fixture.ts",
      "../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in a root file (web.ts) fails",
      "apps/server/src/web.ts",
      "./platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
    [
      "an old-form line in testmail fails",
      "apps/server/src/modules/testmail/__log-fixture.ts",
      "../../platform/log",
      "log.info(`x ${y}`);",
      [2],
    ],
  ] as [string, string, string, string, number[]][])(
    "%s",
    async (_name, file, importPath, line, severities) => {
      expect(await logEventSeverities(file, line, importPath)).toEqual(severities);
    },
    TIMEOUT
  );

  test(
    "an old-form line in main.ts fails",
    async () => {
      expect(
        await logEventSeverities("apps/server/src/main.ts", 'log.error("config error:", e);', "./platform/log")
      ).toEqual([2, 2]);
    },
    TIMEOUT
  );

  test(
    "an old-form line in channels/operator.ts fails",
    async () => {
      expect(
        await logEventSeverities(
          "apps/server/src/modules/channels/operator.ts",
          'log.error("operator notice run:", e);',
          "../../platform/log"
        )
      ).toEqual([2, 2]);
    },
    TIMEOUT
  );

  test(
    "an old-form line in a file of actions or in actions/repo/ fails",
    async () => {
      expect(
        await logEventSeverities(
          "apps/server/src/modules/actions/__log-fixture.ts",
          "log.info(`x ${y}`);",
          "../../platform/log"
        )
      ).toEqual([2]);
      expect(
        await logEventSeverities(
          "apps/server/src/modules/actions/repo/__log-fixture.ts",
          "log.info(`x ${y}`);",
          "../../../platform/log"
        )
      ).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "an old-form line in tenancy fails, also in its repo/ folder",
    async () => {
      for (const file of ["__log-fixture.ts", "repo/__log-fixture.ts"]) {
        const importPath = file.includes("/") ? "../../../platform/log" : "../../platform/log";
        expect(
          await logEventSeverities(`apps/server/src/modules/tenancy/${file}`, "log.info(`x ${y}`);", importPath)
        ).toEqual([2]);
      }
    },
    TIMEOUT
  );

  test(
    "an old-form line in mail fails, also in its imap/ folder",
    async () => {
      for (const file of ["__log-fixture.ts", "imap/__log-fixture.ts"]) {
        const importPath = file.includes("/") ? "../../../platform/log" : "../../platform/log";
        expect(
          await logEventSeverities(`apps/server/src/modules/mail/${file}`, "log.info(`x ${y}`);", importPath)
        ).toEqual([2]);
      }
    },
    TIMEOUT
  );

  test(
    "an event line in platform passes",
    async () => {
      expect(
        await logEventSeverities(
          "apps/server/src/platform/__log-fixture.ts",
          'log.info("sync_done", { count: 1 });',
          "./log"
        )
      ).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a platform test file is ignored",
    async () => {
      expect(
        await logEventSeverities("apps/server/src/platform/__log-fixture.test.ts", "log.info(`x ${y}`);", "./log")
      ).toEqual([]);
    },
    TIMEOUT
  );
});

describe("log lint: the chain, the second argument and .message", () => {
  test(
    "a template literal on a chain fails",
    async () => {
      expect(await logEventSeverities(modFixture, "log.with({}).info(`x ${y}`);")).toEqual([2]);
      expect(await logEventSeverities(modFixture, "mailboxLog.with({}).with({}).warn(`x ${y}`);")).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "free text on a chain fails; an event code on a chain passes",
    async () => {
      expect(await logEventSeverities(modFixture, 'log.with({}).error("free text", {});')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.with({ org_id: id }).info("sync_done", { count: 1 });')).toEqual(
        []
      );
    },
    TIMEOUT
  );

  test(
    "a second argument that is a variable or an error fails",
    async () => {
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", e);')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", fields);')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'mailboxLog.error("x_failed", { ...fields });')).toEqual([]);
      expect(await logEventSeverities(modFixture, 'log.with({}).error("x_failed", err);')).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "a second argument that is an object literal, errorFields or telegramErrorFields passes",
    async () => {
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", { count: 1 });')).toEqual([]);
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", errorFields(e));')).toEqual([]);
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", telegramErrorFields(e));')).toEqual([]);
      expect(await logEventSeverities(modFixture, 'log.error("x_failed", { ...errorFields(e) });')).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a .message field fails, also with a cast, a call or an optional chain",
    async () => {
      expect(await logEventSeverities(modFixture, 'log.info("a", { reason: err.message });')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.info("a", { reason: (e as Error).message });')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.info("a", { reason: String(err.message) });')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.info("a", { reason: err?.message });')).toEqual([2]);
      expect(await logEventSeverities(modFixture, 'log.with({}).info("a", { reason: err.message });')).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "other fields of an error pass the .message selector",
    async () => {
      expect(await logEventSeverities(modFixture, 'log.info("a", { reason: err.name });')).toEqual([]);
      expect(await logEventSeverities(modFixture, 'log.info("a", { count: 1 }); const m = err.message;')).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "test files are ignored",
    async () => {
      expect(
        await logEventSeverities(
          "apps/server/src/modules/mail/__log-fixture.test.ts",
          'log.info("a", { reason: err.message }); log.with({}).info(`x ${y}`); log.error("x_failed", e);'
        )
      ).toEqual([]);
    },
    TIMEOUT
  );
});

describe("log lint: no-console", () => {
  /** Severities of `no-console` for `line` in a virtual file. */
  async function consoleSeverities(file: string, line: string): Promise<number[]> {
    const [result] = await eslint.lintText(`${headerFor("../../platform/log")}${line}\n`, {
      filePath: path.join(repoRoot, file),
    });
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === "no-console")
      .map((message) => message.severity);
  }

  test(
    "console.log in a server file is an error",
    async () => {
      expect(await consoleSeverities(modFixture, "console.log(y);")).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "console.error in a script or in platform is an error",
    async () => {
      expect(await consoleSeverities("apps/server/src/scripts/__log-fixture.ts", "console.error(e);")).toEqual([2]);
      expect(await consoleSeverities("apps/server/src/platform/__log-fixture.ts", "console.warn(e);")).toEqual([2]);
    },
    TIMEOUT
  );

  test(
    "console in a test file is not an error",
    async () => {
      expect(
        (await consoleSeverities("apps/server/src/modules/mail/__log-fixture.test.ts", "console.log(y);")).filter(
          (severity) => severity === 2
        )
      ).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "process.stdout.write is not console output",
    async () => {
      expect(await consoleSeverities(modFixture, "process.stdout.write(y);")).toEqual([]);
    },
    TIMEOUT
  );
});

describe("CLI output border", () => {
  const cliCall = 'createCliOutput("x").print("y");\n';

  /** Messages of `import/no-restricted-paths` for a virtual file that imports `platform/cli`. */
  async function borderMessages(file: string, importPath: string): Promise<string[]> {
    const [result] = await eslint.lintText(`import { createCliOutput } from "${importPath}";\n${cliCall}`, {
      filePath: path.join(repoRoot, file),
    });
    expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === "import/no-restricted-paths")
      .map((message) => message.message);
  }

  test(
    "a module may not import it",
    async () => {
      const messages = await borderMessages("apps/server/src/modules/mail/__cli-fixture.ts", "../../platform/cli");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Only scripts print CLI output (platform/cli.ts)");
    },
    TIMEOUT
  );

  test(
    "a platform file may not import it",
    async () => {
      expect(await borderMessages("apps/server/src/platform/__cli-fixture.ts", "./cli")).toHaveLength(1);
    },
    TIMEOUT
  );

  test(
    "a composition root may not import it",
    async () => {
      expect(await borderMessages("apps/server/src/__cli-fixture.ts", "./platform/cli")).toHaveLength(1);
    },
    TIMEOUT
  );

  test(
    "a script may import it",
    async () => {
      expect(await borderMessages("apps/server/src/scripts/__cli-fixture.ts", "../platform/cli")).toEqual([]);
    },
    TIMEOUT
  );
});
