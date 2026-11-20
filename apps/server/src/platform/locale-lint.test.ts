import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

const TIMEOUT = 30_000;
const fixture = "apps/server/src/modules/mail/__locale-fixture.ts";
const header =
  'import type { UserLocale } from "@ea/core";\nimport { userLocales } from "@ea/core";\nimport { z } from "zod";\n';

/** Severities of the `ea/no-locale-union` messages for `code` in a virtual file. */
async function localeSeverities(code: string, file = fixture): Promise<number[]> {
  const [result] = await eslint.lintText(`${header}${code}\n`, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? []).filter((message) => message.ruleId === "ea/no-locale-union").map((m) => m.severity);
}

describe("no-locale-union", () => {
  test.each([
    'type L = "en" | "pl";',
    'type L = "pl" | "en";',
    'const l = ["pl", "en"] as const;',
    'const s = z.enum(["pl", "en"]);',
    'const s = z.enum(["en", "pl"] as const);',
  ])(
    "reports the copy %s",
    async (code) => {
      expect({ code, severities: await localeSeverities(code) }).toEqual({ code, severities: [2] });
    },
    TIMEOUT
  );

  test.each([
    'type L = "pl" | "en" | "other";',
    "type L = UserLocale;",
    "const s = z.enum(userLocales);",
    'const order: readonly UserLocale[] = ["en", "pl"];',
    'const l = ["pl", "en", "de"] as const;',
  ])(
    "passes %s",
    async (code) => {
      expect({ code, severities: await localeSeverities(code) }).toEqual({ code, severities: [] });
    },
    TIMEOUT
  );

  test.each([
    "packages/core/src/replies/__locale-fixture.ts",
    "apps/server/src/modules/triage/__locale-fixture.ts",
    "packages/core/src/tenancy.ts",
    "apps/web/src/x.test.ts",
  ])(
    "the folder or file %s is out of scope",
    async (file) => {
      expect({ file, severities: await localeSeverities('type L = "en" | "pl";', file) }).toEqual({
        file,
        severities: [],
      });
    },
    TIMEOUT
  );

  test(
    "an .astro file is in scope",
    async () => {
      const file = "apps/web/src/layouts/__locale-fixture.astro";
      const [result] = await eslint.lintText('---\ninterface Props {\n  lang?: "en" | "pl";\n}\n---\n<div />\n', {
        filePath: path.join(repoRoot, file),
      });
      expect((result?.messages ?? []).filter((m) => m.ruleId === "ea/no-locale-union").map((m) => m.severity)).toEqual([
        2,
      ]);
    },
    TIMEOUT
  );
});
