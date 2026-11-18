import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// `sender_suggestions` and `contact_wait` count as off while `sender_context` is off: the profiles are what they read. Only
// `senderFlags` (flags.ts) applies that rule. A caller that reads either flag with `isFeatureOn` or `getOrgFeature` would show
// a suggestion or a contact wait from profiles that a switched-off `sender_context` no longer keeps current. The source is read
// as text: the text between the parentheses of each call must not name the two flags.
const root = join(import.meta.dir, "../..");
const ALLOWED = "modules/contacts/flags.ts";
const GUARDED = ["sender_suggestions", "contact_wait"];
const READERS = ["isFeatureOn", "getOrgFeature"];

/** The text between the parentheses of every call of `name` in `source`. */
function callsOf(source: string, name: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(`${name}(`, from);
    if (start === -1) return calls;
    let depth = 0;
    let end = start + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, end + 1));
    from = start + name.length;
  }
}

describe("the sender flags are read through senderFlags only", () => {
  test("no file but contacts/flags.ts reads `sender_suggestions` or `contact_wait` through a flag reader", async () => {
    const found: string[] = [];
    let scanned = 0;
    for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: root })) {
      if (file.endsWith(".test.ts") || file === ALLOWED) continue;
      scanned += 1;
      const text = readFileSync(join(root, file), "utf8");
      for (const reader of READERS) {
        for (const call of callsOf(text, reader)) {
          if (GUARDED.some((flag) => call.includes(flag))) found.push(`${file}: ${call.replaceAll(/\s+/g, " ")}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });

  test("flags.ts is the one reader: it names both flags in `isFeatureOn` calls", () => {
    // The guard above is only worth its name while the allowed file really holds the reads.
    const calls = callsOf(readFileSync(join(root, ALLOWED), "utf8"), "isFeatureOn").join(" ");
    for (const flag of GUARDED) expect(calls).toContain(flag);
  });
});
