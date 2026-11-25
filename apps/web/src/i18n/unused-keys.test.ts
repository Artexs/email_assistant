import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en, enPlurals } from "./en";
import { pl, plPlurals } from "./pl";

// A text that no page shows must not stay in the dictionaries. A key is used when its name appears as a whole word in a source
// file of the web app, its e2e specs, the docs site, `packages/core` or the server: the core schemas and the server send some keys
// as error codes. The files that define the texts and the unit tests do not count; the e2e specs do.
const repoRoot = join(import.meta.dir, "../../../..");
const SOURCE_DIRS = ["apps/web/src", "apps/web/e2e", "apps/docs/src", "packages/core/src", "apps/server/src"];
const DEFINITIONS = /^apps\/web\/src\/i18n\/(?:texts\/|en\.ts$|pl\.ts$)/;

// A key built at run time (a template such as `cat_${category}`) is found by its prefix. Each prefix is listed once with the
// file that builds it; the last test fails when that file no longer builds a key with the prefix.
const BUILT_PREFIXES: { prefix: string; file: string }[] = [
  { prefix: "legal_kept_until_", file: "apps/web/src/lib/legal-tables.ts" },
  { prefix: "cat_", file: "apps/web/src/components/report/ReportContent.tsx" },
  { prefix: "cat_effect_", file: "apps/web/src/components/settings/CategoriesCard.tsx" },
  { prefix: "folder_", file: "apps/web/src/components/settings/SyncFoldersCard.tsx" },
  { prefix: "sec_kind_", file: "apps/web/src/lib/security-log-text.ts" },
  { prefix: "browser_", file: "apps/web/src/components/settings/AccountCard.tsx" },
  { prefix: "os_", file: "apps/web/src/components/settings/AccountCard.tsx" },
  { prefix: "act_range_", file: "apps/web/src/components/activity/ActivityFilterBar.tsx" },
  { prefix: "act_cat_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "act_rule_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "undo_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "sender_rel_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "stats_m8_", file: "apps/web/src/lib/stats-view.ts" },
  { prefix: "rep_mode_", file: "apps/web/src/components/report/ReportContent.tsx" },
];

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
const prefixes = BUILT_PREFIXES.map((entry) => entry.prefix);

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

  test.each(BUILT_PREFIXES)("$file still builds a key with the prefix $prefix", ({ prefix, file }) => {
    expect(sources.get(file), `${file} is not a source file`).toContain(`${prefix}\${`);
  });
});
