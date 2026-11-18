// Astro integration for the docs site CSP (ADR 0030).
// Astro's `security.csp` hashes only its own module scripts. Starlight adds inline scripts (theme, search dialog,
// sidebar state) and `style` attributes. After the build this pass adds the sha256 of each inline script to
// `script-src`, sets `style-src 'self' 'unsafe-inline'` (a hash in the list makes browsers ignore 'unsafe-inline'),
// then checks every page with `docsCspProblem`. A meta CSP cannot set `frame-ancestors`: the config leaves it out.
// So that no content source can add a script, `assertNoContentScript` runs before the build.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cspMetaContent,
  docsCspProblem,
  inlineScripts,
  parseDirectives,
  scriptHashSource,
  STYLE_DIRECTIVE,
} from "@ea/core/web";
import type { AstroIntegration } from "astro";
import { stepFence, stripCodeSpans } from "../src/markdown-code";

const CSP_META_TAG = /<meta\b[^>]*\bhttp-equiv="content-security-policy"[^>]*>/i;
const META_CONTENT = /\bcontent="[^"]*"/i;

// Adds the missing inline-script hashes to `script-src` and relaxes `style-src` in the page's one CSP meta.
// A page with no or more than one CSP meta stays as it is: `docsCspProblem` reports it.
export function finalizePage(html: string): { html: string; hashed: number } {
  const content = cspMetaContent(html);
  if (content === null) return { html, hashed: 0 };
  const directives = parseDirectives(content).map((d) => d.text);
  const scriptIndex = directives.findIndex((text) => text.split(/\s+/)[0] === "script-src");
  let hashed = 0;
  if (scriptIndex >= 0) {
    const tokens = (directives[scriptIndex] ?? "").split(/\s+/);
    for (const text of inlineScripts(html)) {
      const source = scriptHashSource(text);
      if (!tokens.includes(source)) {
        tokens.push(source);
        hashed += 1;
      }
    }
    directives[scriptIndex] = tokens.join(" ");
  }
  const styleIndex = directives.findIndex((text) => text.split(/\s+/)[0] === "style-src");
  if (styleIndex >= 0) directives[styleIndex] = STYLE_DIRECTIVE;
  else directives.push(STYLE_DIRECTIVE);

  const next = `content="${directives.join("; ")};"`;
  const withContent = html.replace(CSP_META_TAG, (meta) => meta.replace(META_CONTENT, () => next));
  return { html: withContent, hashed };
}

function* filesUnder(dir: string, suffixes: readonly string[]): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* filesUnder(path, suffixes);
    else if (suffixes.some((suffix) => entry.endsWith(suffix))) yield path;
  }
}

// Finalizes (rewrites a changed file) and checks every .html file under dir.
// Throws Error(`${problem} in ${relativePath}`) at the first bad page, Error("no html page in the build") when none exists.
export function finalizeDist(dir: string): { checked: number; hashed: number } {
  let checked = 0;
  let hashed = 0;
  for (const file of filesUnder(dir, [".html"])) {
    const html = readFileSync(file, "utf8");
    const result = finalizePage(html);
    if (result.html !== html) writeFileSync(file, result.html);
    hashed += result.hashed;
    const problem = docsCspProblem(result.html);
    if (problem) throw new Error(`${problem} in ${relative(dir, file)}`);
    checked += 1;
  }
  if (checked === 0) throw new Error("no html page in the build");
  return { checked, hashed };
}

const CONTENT_SCRIPT_RULES = [/<script/i, /javascript:/i, /\son[a-z]+\s*=/i];

// The first line of a content source that holds a script, as `content_script <file>:<line>`, or null.
// Code fences and inline code spans are skipped: the renderer escapes them (an unclosed backtick is scanned).
export function contentScriptProblem(text: string, file: string): string | null {
  const lines = text.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const step = stepFence(fence, lines[i] ?? "");
    fence = step.fence;
    if (step.code) continue;
    const outsideCode = stripCodeSpans(lines[i] ?? "");
    if (CONTENT_SCRIPT_RULES.some((rule) => rule.test(outsideCode))) return `content_script ${file}:${i + 1}`;
  }
  return null;
}

// Every .md and .mdx file under contentDir, and each file of extraFiles (in-place sources), holds no `<script`,
// no `javascript:` and no ` on<letters>=` attribute. Paths in the error are relative to root.
export function assertNoContentScript(root: string, contentDir: string, extraFiles: readonly string[] = []): void {
  const files = [...filesUnder(contentDir, [".md", ".mdx"]), ...extraFiles];
  for (const file of files) {
    const problem = contentScriptProblem(readFileSync(file, "utf8"), relative(root, file));
    if (problem) throw new Error(problem);
  }
}

export interface CspFinalizeOptions {
  // Sources outside `src/content/docs` that become pages (`IN_PLACE_PAGES`), as absolute paths.
  extraContentFiles?: readonly string[];
}

export default function cspFinalize(options: CspFinalizeOptions = {}): AstroIntegration {
  return {
    name: "ea-csp-finalize",
    hooks: {
      "astro:config:setup": ({ config }) => {
        const root = fileURLToPath(config.root);
        assertNoContentScript(root, join(root, "src/content/docs"), options.extraContentFiles);
      },
      "astro:build:done": ({ dir, logger }) => {
        const { checked, hashed } = finalizeDist(fileURLToPath(dir));
        logger.info(`script hashes added: ${hashed}`);
        logger.info(`csp checked in ${checked} page(s)`);
      },
    },
  };
}
