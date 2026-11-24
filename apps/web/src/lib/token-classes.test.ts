import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The look of the panel lives in the tokens of `styles/global.css`. A component uses token classes only (`bg-primary`,
// `text-muted-foreground`). This scan reads every `.ts`, `.tsx` and `.astro` file of `apps/web/src` except tests and the
// dev pages, and reports the ways a raw colour or an inline style comes back. `docs/decisions/0037-panel-design-system.md`
// holds the rule.

const srcDir = join(import.meta.dir, "..");

const PROPERTIES = "bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration";
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    name: "a palette class",
    pattern: new RegExp(`\\b(?:${PROPERTIES})-(?:${PALETTE})(?:-\\d{2,3})?(?![\\w-])(?:/\\d+)?`, "g"),
  },
  {
    name: "a white or black class",
    pattern: new RegExp(`\\b(?:${PROPERTIES})-(?:white|black)(?![\\w-])(?:/\\d+)?`, "g"),
  },
  { name: "a hex colour", pattern: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g },
  { name: "a colour function", pattern: /\b(?:rgba?|hsla?|oklch)\(/g },
  { name: "an inline style", pattern: /\bstyle=/g },
  { name: "a focus colour with an opacity", pattern: /\b(?:ring|outline)-ring\/\d+/g },
  {
    name: "an accent class",
    pattern:
      /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|shadow)-accent\b(?:-foreground)?(?:\/\d+)?/g,
  },
];

// The warm box, the warning banner and the warm dot of the empty-state picture are the only files that read the accent tokens.
const ACCENT_FILES = [
  "components/patterns/FactBox.tsx",
  "components/patterns/EmptyState.tsx",
  "components/shell/AuthErrorBanner.tsx",
];

interface Hit {
  line: number;
  rule: string;
  match: string;
}

function findColours(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  for (const { name, pattern } of RULES) {
    if (name === "an accent class" && ACCENT_FILES.includes(file)) continue;
    for (const found of text.matchAll(pattern)) {
      const line = text.slice(0, found.index).split("\n").length;
      hits.push({ line, rule: name, match: found[0] });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

// One line per problem, with the file, the line and the text that matched.
export function colourProblems(file: string, text: string): string[] {
  return findColours(file, text).map((hit) => `${file}:${hit.line}: ${hit.rule} "${hit.match}"`);
}

// The only raw values the panel keeps. A `match` is the text the scan reports in that file.
const ALLOWED: { file: string; match: string; reason: string }[] = [
  { file: "components/ui/dialog.tsx", match: "bg-black/50", reason: "the scrim behind a dialog" },
  { file: "components/ui/sheet.tsx", match: "bg-black/50", reason: "the scrim behind a sheet" },
  { file: "components/settings/TotpQr.tsx", match: "bg-white", reason: "a QR code needs a light ground to scan" },
  { file: "components/settings/TotpQr.tsx", match: "#000", reason: "a QR code needs dark modules to scan" },
  { file: "layouts/App.astro", match: "#000832", reason: "the theme-color of the browser bar" },
  { file: "layouts/Public.astro", match: "#000832", reason: "the theme-color of the browser bar" },
];

function isAllowed(file: string, hit: Hit): boolean {
  return ALLOWED.some((entry) => entry.file === file && entry.match === hit.match);
}

function sourceFiles(): string[] {
  const files = [...new Glob("**/*.{ts,tsx,astro}").scanSync({ cwd: srcDir })];
  return files.filter((file) => !/\.test\.tsx?$/.test(file) && !file.startsWith("dev/")).sort();
}

describe("colourProblems", () => {
  test("a palette class names itself", () => {
    expect(colourProblems("a.tsx", '<p className="bg-amber-50">')).toEqual(['a.tsx:1: a palette class "bg-amber-50"']);
  });

  test.each(["text-muted-foreground", "bg-primary/90", "border-destructive", "ring-ring"])(
    "the token class %s passes",
    (name) => {
      expect(colourProblems("a.tsx", `<p className="${name}">`)).toEqual([]);
    }
  );

  test("an inline style is a problem", () => {
    expect(colourProblems("a.tsx", "<p style={{ width: 3 }}>")).toEqual(['a.tsx:1: an inline style "style="']);
  });

  test("a hex colour in a string is a problem", () => {
    expect(colourProblems("a.tsx", 'const c = "#0a7568";')).toEqual(['a.tsx:1: a hex colour "#0a7568"']);
  });

  test.each([
    ['className="text-white"', "a white or black class", "text-white"],
    ['className="bg-black/50"', "a white or black class", "bg-black/50"],
    ['className="ring-ring/50"', "a focus colour with an opacity", "ring-ring/50"],
    ['className="hover:bg-accent"', "an accent class", "bg-accent"],
    ["const c = `oklch(0.5 0 0)`;", "a colour function", "oklch("],
  ])("%s gives one problem", (text, rule, match) => {
    expect(colourProblems("a.tsx", text)).toEqual([`a.tsx:1: ${rule} "${match}"`]);
  });

  test("the accent class passes in the files that own it", () => {
    expect(
      colourProblems("components/shell/AuthErrorBanner.tsx", '<p className="bg-accent text-accent-foreground">')
    ).toEqual([]);
  });

  test("a link to an anchor is not a hex colour", () => {
    expect(colourProblems("a.astro", '<a href="#main-content">')).toEqual([]);
  });
});

describe("the source tree", () => {
  test("the walk reads the tree", () => {
    expect(sourceFiles().length).toBeGreaterThan(100);
  });

  test("no file holds a raw colour, an inline style or an accent class", () => {
    const problems = sourceFiles().flatMap((file) => {
      const text = readFileSync(join(srcDir, file), "utf8");
      return findColours(file, text)
        .filter((hit) => !isAllowed(file, hit))
        .map((hit) => `${file}:${hit.line}: ${hit.rule} "${hit.match}"`);
    });
    expect(problems).toEqual([]);
  });

  test.each(ALLOWED)("the allowed $match in $file is still there", ({ file, match }) => {
    const hits = findColours(file, readFileSync(join(srcDir, file), "utf8"));
    expect(hits.map((hit) => hit.match)).toContain(match);
  });
});
