import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// A source file that no other file imports is a leftover: the page that used it is gone. The candidates are the files of
// `components/`, `islands/`, `lib/` and `layouts/` (no tests). An importer is any file of `apps/web` that is not a test: a source
// file, a page, a script, an e2e helper or a file of `dev/` (the pattern page counts as a user). `docs/decisions/0037-panel-design-system.md`
// holds the rule. A file that must stay with no importer gets a reason in the ticket's `sweep.md`, and the ADR names it.

const webDir = join(import.meta.dir, "../..");
const EXTENSIONS = [".ts", ".tsx", ".astro", ".mjs", ".js"];
const CANDIDATE_DIRS = ["src/components/", "src/islands/", "src/lib/", "src/layouts/"];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

// Paths are relative to `apps/web`, with `/` as the separator. The path an import names, as the files it can mean.
function resolveImport(importer: string, specifier: string, files: Set<string>): string | undefined {
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith(".")
      ? normalize(join(dirname(importer), specifier))
      : undefined;
  if (base === undefined) return undefined;
  const tries = [base, ...EXTENSIONS.map((ext) => `${base}${ext}`), ...EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  return tries.find((path) => files.has(path));
}

// The candidate files that no other file of `sources` imports (`sources` maps a path to its text).
export function unusedFiles(sources: Map<string, string>): string[] {
  const files = new Set(sources.keys());
  const used = new Set<string>();
  for (const [importer, text] of sources) {
    if (isTest(importer)) continue;
    for (const [, specifier = ""] of text.matchAll(SPECIFIER)) {
      const target = resolveImport(importer, specifier, files);
      if (target !== undefined && target !== importer) used.add(target);
    }
  }
  return [...files]
    .filter((path) => CANDIDATE_DIRS.some((dir) => path.startsWith(dir)) && !isTest(path) && !used.has(path))
    .sort();
}

function fixture(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("unusedFiles", () => {
  test("a file that no other file imports is reported", () => {
    const sources = fixture({
      "src/pages/index.astro": '---\nimport "../lib/a";\n---',
      "src/lib/a.tsx": 'import { b } from "./b";',
      "src/lib/b.tsx": "export const b = 1;",
      "src/lib/c.tsx": "export const c = 2;",
    });
    expect(unusedFiles(sources)).toEqual(["src/lib/c.tsx"]);
  });

  test.each(["./b.tsx", "./b"])("the import %s counts for b.tsx", (specifier) => {
    const sources = fixture({
      "src/pages/index.astro": '---\nimport { a } from "../lib/a";\n---',
      "src/lib/a.tsx": `import { b } from "${specifier}";`,
      "src/lib/b.tsx": "export const b = 1;",
    });
    expect(unusedFiles(sources)).toEqual([]);
  });

  test("an import through the @/ alias counts", () => {
    const sources = fixture({
      "src/pages/index.astro": 'import { X } from "@/components/ui/b";',
      "src/components/ui/b.tsx": "export const X = 1;",
    });
    expect(unusedFiles(sources)).toEqual([]);
  });

  test("a file that only a dev file imports is not reported", () => {
    const sources = fixture({
      "src/dev/sections/x.tsx": 'import { T } from "../../components/ui/tabs";',
      "src/components/ui/tabs.tsx": "export const T = 1;",
    });
    expect(unusedFiles(sources)).toEqual([]);
  });

  test("a file that only its own test imports is reported", () => {
    const sources = fixture({
      "src/lib/d.test.ts": 'import { d } from "./d";',
      "src/lib/d.ts": "export const d = 1;",
    });
    expect(unusedFiles(sources)).toEqual(["src/lib/d.ts"]);
  });
});

describe("the source of the web app", () => {
  test("every component, island, lib and layout file has an importer", () => {
    const sources = new Map<string, string>();
    for (const file of new Glob("**/*.{ts,tsx,astro,mjs,js}").scanSync({ cwd: webDir })) {
      if (/(^|\/)(node_modules|dist|\.astro|test-results)\//.test(file)) continue;
      sources.set(file, readFileSync(join(webDir, file), "utf8"));
    }
    expect(sources.size).toBeGreaterThan(300);
    expect(unusedFiles(sources)).toEqual([]);
  });
});
