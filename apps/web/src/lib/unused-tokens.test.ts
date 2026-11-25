import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A token of `styles/global.css` that nothing reads is a leftover of an old look. A token is read when a source file or a rule of
// the file reads it with `var(--name)`, or when a source file holds the class its theme name makes (`--color-primary` gives
// `bg-primary`, `--radius-lg` gives `rounded-lg`). A token that only an unused token reads is unused.
// `docs/decisions/0037-panel-design-system.md` holds the token table: a token that goes here goes there too.

const srcDir = join(import.meta.dir, "..");

const COLOUR_PROPERTIES =
  "bg|text|border|border-[xytblrse]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder";
// The theme namespaces of Tailwind and the class that reads each one.
const CLASS_PREFIX: Record<string, string> = {
  radius: "rounded(?:-[a-z]{1,2})?",
  text: "text",
  font: "font",
  shadow: "shadow",
};
// Tailwind's base styles read these two without a class.
const ALWAYS_USED = new Set(["--font-sans", "--font-mono"]);

const DECLARATION = /(--[\w-]+)\s*:\s*([^;}]+);/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function holdsClass(sources: string, prefix: string, name: string): boolean {
  const pattern = new RegExp(`(?<![\\w-])(?:[\\w[\\]-]+:)*!?(?:${prefix})-${escapeRegExp(name)}(?![\\w-])`);
  return pattern.test(sources);
}

// Every token of `css` that nothing in `css` or `sources` reads, in file order.
export function unusedTokens(css: string, sources: string): string[] {
  const values = new Map<string, string>();
  for (const [, name = "", value = ""] of css.matchAll(DECLARATION))
    values.set(name, `${values.get(name) ?? ""} ${value}`);
  // What is left once the declarations are cut out: the rules and the source files.
  const readers = `${css.replace(DECLARATION, "")}\n${sources}`;
  const directVars = new Set([...readers.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? ""));

  const isUsedByName = (token: string): boolean => {
    if (ALWAYS_USED.has(token) || directVars.has(token)) return true;
    const [, namespace = "", name = ""] = /^--([a-z]+)-(.+)$/.exec(token) ?? [];
    if (namespace === "color") return holdsClass(readers, COLOUR_PROPERTIES, name);
    const prefix = CLASS_PREFIX[namespace];
    return prefix !== undefined && holdsClass(readers, prefix, name);
  };

  const used = new Set<string>();
  const queue = [...values.keys()].filter((token) => !token.includes("--", 2) && isUsedByName(token));
  for (const token of queue) {
    if (used.has(token)) continue;
    used.add(token);
    // A token that a used token reads is used, and so is every companion of it (`--text-xs--line-height`).
    for (const [, read = ""] of (values.get(token) ?? "").matchAll(/var\(\s*(--[\w-]+)/g)) queue.push(read);
  }
  for (const token of values.keys()) {
    const base = token.slice(0, token.indexOf("--", 2) < 0 ? undefined : token.indexOf("--", 2));
    if (base !== token && used.has(base)) used.add(token);
  }
  return [...values.keys()].filter((token) => !used.has(token));
}

describe("unusedTokens", () => {
  test("a colour token with no class is reported with the token it reads", () => {
    const css = ":root { --secondary: #eee; }\n@theme inline { --color-secondary: var(--secondary); }";
    expect(unusedTokens(css, 'const a = "bg-primary";')).toEqual(["--secondary", "--color-secondary"]);
  });

  test("a token that a used token reads is used", () => {
    const css = ":root { --avatar-3: #235ebf; }\n@theme inline { --color-avatar-3: var(--avatar-3); }";
    expect(unusedTokens(css, 'const a = "bg-avatar-3";')).toEqual([]);
  });

  test("a class with an opacity or a state counts for its colour", () => {
    const css = ":root { --primary: #0a7568; }\n@theme inline { --color-primary: var(--primary); }";
    expect(unusedTokens(css, 'const a = "bg-primary/50";')).toEqual([]);
    expect(unusedTokens(css, 'const a = "hover:text-primary";')).toEqual([]);
  });

  test("a class that only ends with the name does not count", () => {
    const css = ":root { --foreground: #111; }\n@theme inline { --color-foreground: var(--foreground); }";
    expect(unusedTokens(css, 'const a = "text-primary-foreground";')).toEqual(["--foreground", "--color-foreground"]);
  });

  test("a token that a rule reads with var() is used", () => {
    const css = ":root { --border: #ddd; }\n.legal-draft { border: 1px solid var(--border); }";
    expect(unusedTokens(css, "")).toEqual([]);
  });

  test("the font tokens of the base styles are used with no class", () => {
    expect(unusedTokens("@theme { --font-sans: Nunito; }", "")).toEqual([]);
  });

  test("a companion token follows its token", () => {
    const css = "@theme { --text-xs: 0.8rem; --text-xs--line-height: 1.2; }";
    expect(unusedTokens(css, 'const a = "text-xs";')).toEqual([]);
    expect(unusedTokens(css, 'const a = "text-sm";')).toEqual(["--text-xs", "--text-xs--line-height"]);
  });

  test("a radius token is used by its rounded class", () => {
    const css = "@theme inline { --radius-md: 16px; --radius-xl: 28px; }";
    expect(unusedTokens(css, 'const a = "rounded-t-md";')).toEqual(["--radius-xl"]);
  });
});

describe("the tokens of the web app", () => {
  test("every token of global.css is read", () => {
    let sources = "";
    for (const file of new Glob("**/*.{ts,tsx,astro}").scanSync({ cwd: srcDir })) {
      if (/\.test\.tsx?$/.test(file)) continue;
      sources += `\n${readFileSync(join(srcDir, file), "utf8")}`;
    }
    expect(sources.length).toBeGreaterThan(100_000);
    expect(unusedTokens(readFileSync(join(srcDir, "styles/global.css"), "utf8"), sources)).toEqual([]);
  });
});
