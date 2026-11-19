import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// The address pattern of `addressRegex` is case-sensitive and holds every case form of each letter. A match that runs it
// with the case-insensitive operator or the flag `i` would match a dotless `ı` like an `i` again, and one that runs it
// without `matchesAddress` or `replaceAddress` could drift from the other three. Only `address-map.ts` writes the SQL.
const DIRECTORY = join(import.meta.dir, "../../src/modules/privacy");

describe("the address pattern runs only through matchesAddress and replaceAddress", () => {
  const files = readdirSync(DIRECTORY).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "address-map.ts"
  );

  test("the privacy module has source files to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  test("no other file runs a pattern: no `~` operator, no regexp function, no flag `i`", () => {
    const found = files.filter((name) =>
      /~\*|~\s*\$\{|'g?i'|regexp_(replace|match|split|substr)/.test(readFileSync(join(DIRECTORY, name), "utf8"))
    );
    expect(found).toEqual([]);
  });

  test("the two helpers write the case-sensitive forms", () => {
    const source = readFileSync(join(DIRECTORY, "address-map.ts"), "utf8");
    expect(source).toContain("${ref} ~ ${pattern}");
    expect(source).toContain("regexp_replace(${ref}, ${pattern}, ${replacement}, 'g')");
    expect(source).not.toMatch(/~\*|'gi'/);
  });
});
