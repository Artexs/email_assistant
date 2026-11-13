import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

const header =
  'import { createLog } from "../../platform/log";\n\nconst log = createLog("mail");\nconst mailboxLog = log.with({});\ndeclare const id: string, e: unknown, a: unknown, b: unknown, y: string;\n';

const TIMEOUT = 30_000;
const fixtureFile = "apps/server/src/modules/mail/__log-fixture.ts";

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

describe("log lint: old forms warn", () => {
  test(
    "a template literal warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, "log.info(`sync ${id} done`);")).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "free text warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.info("sync done");')).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "a plain string with ${ warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.info("sync ${id}");')).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "a text with an error argument warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.error("config error:", e);')).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "three arguments warn",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.warn("ping_failed", a, b);')).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "a child logger with a template literal warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, "mailboxLog.info(`x ${y}`);")).toEqual([1]);
    },
    TIMEOUT
  );

  test(
    "a call with no argument warns",
    async () => {
      expect(await logEventSeverities(fixtureFile, "log.info();")).toEqual([1]);
    },
    TIMEOUT
  );
});

describe("log lint: event form passes", () => {
  test(
    "an event code with fields passes",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.info("sync_done", { mailbox_id: id });')).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "an event code alone passes",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'log.info("sync_done");')).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a child logger with an event code passes",
    async () => {
      expect(await logEventSeverities(fixtureFile, 'mailboxLog.debug("sync_done", {});')).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "console calls are not log calls",
    async () => {
      expect(await logEventSeverities(fixtureFile, "console.info(`x ${y}`);")).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "test files are ignored",
    async () => {
      expect(
        await logEventSeverities("apps/server/src/modules/mail/__log-fixture.test.ts", "log.info(`sync ${id} done`);")
      ).toEqual([]);
    },
    TIMEOUT
  );
});
