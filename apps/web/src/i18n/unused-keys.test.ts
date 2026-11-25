import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en, enPlurals } from "./en";
import { pl, plPlurals } from "./pl";
import { RUNTIME_KEY_PREFIXES } from "./runtime-key-prefixes";

// A text that no page shows must not stay in the dictionaries. A key is used when its name appears as a whole word in a source
// file of the web app, its e2e specs, the docs site, `packages/core` or the server: the core schemas and the server send some keys
// as error codes. The files that define the texts and the unit tests do not count; the e2e specs do.
const repoRoot = join(import.meta.dir, "../../../..");
const SOURCE_DIRS = ["apps/web/src", "apps/web/e2e", "apps/docs/src", "packages/core/src", "apps/server/src"];
const DEFINITIONS = /^apps\/web\/src\/i18n\/(?:texts\/|en\.ts$|pl\.ts$)/;

// The keys that no file names and no listed prefix covers.
export function unusedKeys(keys: string[], sources: string[], prefixes: string[]): string[] {
  const words = new Set(sources.flatMap((text) => text.match(/\w+/g) ?? []));
  return keys.filter((key) => !words.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)));
}

function readSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of new Glob("**/*.{ts,tsx,astro,md,mdx,js,mjs}").scanSync({ cwd: join(repoRoot, dir) })) {
      const path = `${dir}/${file}`;
      if (DEFINITIONS.test(path) || /\.test\.tsx?$/.test(path)) continue;
      sources.set(path, readFileSync(join(repoRoot, path), "utf8"));
    }
  }
  return sources;
}

const sources = readSources();
const prefixes = RUNTIME_KEY_PREFIXES.map((entry) => entry.prefix);

describe("unusedKeys", () => {
  test("a key that no source names is reported", () => {
    expect(unusedKeys(["zz_never_used", "used_key"], ["t('used_key')"], [])).toEqual(["zz_never_used"]);
  });

  test("a key is found as a whole word only", () => {
    expect(unusedKeys(["save"], ["t('save_all')"], [])).toEqual(["save"]);
  });

  test("a key that starts with a listed prefix is used", () => {
    expect(unusedKeys(["cat_spam", "cats_x"], ["t(`cat_${category}`)"], ["cat_"])).toEqual(["cats_x"]);
  });

  test("a key that only a core schema names is used", () => {
    expect(
      unusedKeys(["empty_patch"], [readFileSync(join(repoRoot, "packages/core/src/web/organization.ts"), "utf8")], [])
    ).toEqual([]);
  });
});

describe("the dictionaries", () => {
  test("the scan reads the source files", () => {
    expect(sources.size).toBeGreaterThan(500);
  });

  test.each([
    ["en", Object.keys(en), Object.keys(enPlurals)],
    ["pl", Object.keys(pl), Object.keys(plPlurals)],
  ])("no %s text or plural text is unused", (_language, textKeys, pluralKeys) => {
    expect(unusedKeys([...textKeys, ...pluralKeys], [...sources.values()], prefixes)).toEqual([]);
  });

  test.each(RUNTIME_KEY_PREFIXES)("$file still builds a key with the prefix $prefix", ({ prefix, file }) => {
    expect(sources.get(file), `${file} is not a source file`).toContain(`${prefix}\${`);
  });
});
