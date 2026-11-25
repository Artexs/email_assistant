import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { RUNTIME_KEY_PREFIXES } from "../../web/src/i18n/runtime-key-prefixes";
import { inPlaceSourcePaths } from "./in-place";
import { docsKeys, docsOnlyKeys, docsOnlyMessage, type SourceFile } from "./panel-keys";
import { uiText } from "./ui-text";

const ROOT = join(import.meta.dir, "../../..");
const PANEL_DIRS = ["apps/web/src", "packages/core/src", "apps/server/src"];

function readFiles(pattern: string, dir: string, skip: (path: string) => boolean = () => false): SourceFile[] {
  const files: SourceFile[] = [];
  for (const file of new Glob(pattern).scanSync({ cwd: join(ROOT, dir) })) {
    const path = `${dir}/${file}`;
    if (!skip(path)) files.push({ path, text: readFileSync(join(ROOT, path), "utf8") });
  }
  return files;
}

// The docs pages, the docs components and the operator pages that the site shows in place.
const docsFiles: SourceFile[] = [
  ...readFiles("**/*.{md,mdx}", "apps/docs/src/content"),
  ...readFiles("**/*.astro", "apps/docs/src/components"),
  ...inPlaceSourcePaths(ROOT).map((absolute) => {
    const path = relative(ROOT, absolute);
    return { path, text: readFileSync(absolute, "utf8") };
  }),
];

// The panel: its code without the text dictionaries and the unit tests.
const panelFiles: SourceFile[] = PANEL_DIRS.flatMap((dir) =>
  readFiles("**/*.{ts,tsx,astro}", dir, (path) => /\.test\.|^apps\/web\/src\/i18n\//.test(path))
);

describe("docsOnlyKeys over the real tree", () => {
  test("the scan reads the docs files and the panel files", () => {
    expect(docsFiles.length).toBeGreaterThan(30);
    expect(panelFiles.length).toBeGreaterThan(500);
  });

  test("every docs key is read by the panel", () => {
    expect(docsOnlyKeys(docsFiles, panelFiles, RUNTIME_KEY_PREFIXES).map(docsOnlyMessage)).toEqual([]);
  });

  test("every docs key passes uiText in both languages", () => {
    const keys = new Set(docsFiles.flatMap((file) => docsKeys(file.text)));
    expect(keys.size).toBeGreaterThan(50);
    for (const key of keys) {
      expect(uiText(key, "en")).not.toBe("");
      expect(uiText(key, "pl")).not.toBe("");
    }
  });
});

describe("docsOnlyKeys", () => {
  test("a docs key that no panel file reads is reported with its docs file", () => {
    const docs = [{ path: "a.mdx", text: '<UiText k="zz_docs_only" />' }];
    const panel = [{ path: "b.tsx", text: 't("other")' }];
    expect(docsOnlyKeys(docs, panel, [])).toEqual([{ key: "zz_docs_only", file: "a.mdx" }]);
  });

  test("a docs key under a run-time prefix passes", () => {
    const docs = [{ path: "a.mdx", text: '<UiText k="switch_move" />' }];
    const panel = [{ path: "b.tsx", text: "t(`switch_${name}`)" }];
    expect(docsOnlyKeys(docs, panel, [{ prefix: "switch_" }])).toEqual([]);
  });

  test("a key counts as a whole word only", () => {
    const docs = [{ path: "a.mdx", text: '<UiText k="nav_rules" />' }];
    const panel = [{ path: "b.tsx", text: 't("nav_rules_hint")' }];
    expect(docsOnlyKeys(docs, panel, [])).toEqual([{ key: "nav_rules", file: "a.mdx" }]);
  });

  test("a key in two docs files gives two results sorted by file", () => {
    const text = "<UiText k='zz_twice' />";
    const docs = [
      { path: "z.mdx", text },
      { path: "a.mdx", text: `${text} ${text}` },
    ];
    expect(docsOnlyKeys(docs, [], [])).toEqual([
      { key: "zz_twice", file: "a.mdx" },
      { key: "zz_twice", file: "z.mdx" },
    ]);
  });

  test("the failure text names the key and the docs file", () => {
    expect(docsOnlyMessage({ key: "zz_probe", file: "a.mdx" })).toBe("docs_key_not_in_panel zz_probe a.mdx");
  });
});
