import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// `activity.ts` composes the readers of the mail, triage and delegation modules; it holds no SQL of its own. This scan keeps it
// so: a column change in those tables must fail in their module, not in the profile pass.
const text = readFileSync(join(import.meta.dir, "activity.ts"), "utf8");

const FORBIDDEN: [name: string, pattern: RegExp][] = [
  ["a sql template (sql`, sql<T>`, sql.raw()", /\bsql\s*[<`.(]/],
  ["selectFrom(", /selectFrom\(/],
  [".execute(", /\.execute\(/],
  ['a value import from "kysely"', /^import\s+(?!type\b)[^;]*from\s+"kysely"/m],
];

describe("contacts/activity.ts", () => {
  test.each(FORBIDDEN)("1 holds no %s", (_name, pattern) => {
    expect(pattern.test(text)).toBe(false);
  });

  test("2 stays under 400 lines", () => {
    expect(text.split("\n").length).toBeLessThan(400);
  });
});
