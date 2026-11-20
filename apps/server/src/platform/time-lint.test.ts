import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

const TIMEOUT = 30_000;
const fixture = "apps/server/src/modules/mail/__time-fixture.ts";
const header = 'import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";\ndeclare const d: number;\n';

/** Severities of the `ea/no-time-literals` messages for `code` in a virtual file. */
async function timeSeverities(code: string, file = fixture): Promise<number[]> {
  const [result] = await eslint.lintText(`${header}${code}\n`, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? []).filter((message) => message.ruleId === "ea/no-time-literals").map((m) => m.severity);
}

/** Each snippet gives the same list of severities. */
async function expectEach(snippets: string[], expected: number[], file = fixture): Promise<void> {
  for (const snippet of snippets)
    expect({ snippet, severities: await timeSeverities(snippet, file) }).toEqual({ snippet, severities: expected });
}

describe("no-time-literals: literals and chains report", () => {
  test("a lone minute literal", () => expectEach(["const a = 60_000;"], [2]), TIMEOUT);
  test(
    "any spelling of the minute",
    () => expectEach(["const a = 60000;", "const a = 6e4;", "const a = -60_000;"], [2]),
    TIMEOUT
  );
  test("an hour and a day literal", () => expectEach(["const a = 3_600_000;", "const a = 86_400_000;"], [2]), TIMEOUT);
  test("a chain reports once", () => expectEach(["const a = 24 * 60 * 60 * 1000;"], [2]), TIMEOUT);
  test(
    "order, parentheses and casts do not hide a chain",
    () =>
      expectEach(
        [
          "const a = 5 * 60 * 1000;",
          "const a = 1000 * 60 * 60;",
          "const a = 60 * (60 * 1000);",
          "const a = (60 as number) * 1000;",
        ],
        [2]
      ),
    TIMEOUT
  );
  test(
    "an identifier in the chain or a division",
    () => expectEach(["const a = d * 60 * 1000;", "const a = d / 60_000;"], [2]),
    TIMEOUT
  );
  test(
    "a literal inside a chain adds no second report",
    () => expectEach(["const a = 7 * 24 * 3_600_000;"], [2]),
    TIMEOUT
  );
  test(
    "a fraction does not hide a minute",
    () => expectEach(["const a = 1.5 * 60_000;", "const a = 1.5 * 60 * 1000;"], [2]),
    TIMEOUT
  );
});

describe("no-time-literals: other numbers pass", () => {
  test(
    "seconds, small products, lone multiples and strings",
    () =>
      expectEach(
        [
          "const a = 30 * 1000;",
          "const a = 60 * 60;",
          "const a = 120_000;",
          'const a = "60000";',
          "const a = 60 * 60 * 24 * 30;",
        ],
        []
      ),
    TIMEOUT
  );
  test(
    "the unit names with a small factor",
    () => expectEach(["const a = 7 * DAY_MS;", "const b = 90 * MINUTE_MS;"], []),
    TIMEOUT
  );
});

describe("no-time-literals: units and copies", () => {
  test(
    "a factor that folds into the next unit",
    () =>
      expectEach(
        [
          "const a = 60 * MINUTE_MS;",
          "const a = 120 * MINUTE_MS;",
          "const a = 24 * HOUR_MS;",
          "const a = 48 * HOUR_MS;",
          "const a = d * 24 * HOUR_MS;",
        ],
        [2]
      ),
    TIMEOUT
  );
  test(
    "a local copy of a unit name",
    () => expectEach(["const HOUR = 60;", "export const DAY_MS = 1;", "class A { MINUTE_MS = 1; }"], [2]),
    TIMEOUT
  );
});

describe("no-time-literals: scope", () => {
  const text = "const a = 60_000;";
  test(
    "the time module, tests, specs, test helpers and test folders are out",
    () =>
      expectEach([text], [], "packages/core/src/time.ts").then(async () => {
        for (const file of [
          "apps/server/src/modules/mail/x.test.ts",
          "apps/web/src/x.spec.ts",
          "packages/core/src/loops/x.test-helper.ts",
          "apps/web/e2e/x.ts",
          "apps/server/test/integration/x.ts",
        ]) {
          expect({ file, severities: await timeSeverities(text, file) }).toEqual({ file, severities: [] });
        }
      }),
    TIMEOUT
  );
  test(
    "core, web, docs and tool sources are in",
    async () => {
      for (const file of [
        "packages/core/src/sim/__f.ts",
        "apps/web/src/lib/__f.ts",
        "apps/web/src/islands/__f.tsx",
        "apps/docs/src/__f.ts",
        "tools/fake-telegram/src/__f.ts",
      ]) {
        expect({ file, severities: await timeSeverities(text, file) }).toEqual({ file, severities: [2] });
      }
    },
    TIMEOUT
  );
  test(
    "a disable comment with a reason silences a value that is not a time",
    () => expectEach(["// eslint-disable-next-line ea/no-time-literals -- a count\nconst a = 60_000;"], []),
    TIMEOUT
  );
});
