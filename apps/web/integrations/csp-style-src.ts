// Astro integration: after the build, replace the hashed `style-src` of every page's CSP meta with
// `style-src 'self' 'unsafe-inline'`, then check that every page still carries the ADR 0016 CSP.
// Radix overlays inject a scroll-lock <style> whose text varies with the scrollbar width, so no fixed hash exists;
// a hash in the list makes browsers ignore 'unsafe-inline'. Scripts stay hashed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

export const STYLE_SRC = /style-src [^;"]*;?/;
const STYLE_DIRECTIVE = "style-src 'self' 'unsafe-inline'";
export const RELAXED_STYLE_SRC = `${STYLE_DIRECTIVE};`;
const CSP_META_TAG = /<meta\b[^>]*\bhttp-equiv="content-security-policy"[^>]*>/gi;
const META_CONTENT = /\bcontent="([^"]*)"/i;
const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem", "script-src-attr"]);
const STYLE_SPLIT_DIRECTIVES = new Set(["style-src-elem", "style-src-attr"]);

export type CspProblem =
  | "csp_meta_count" // not exactly one <meta http-equiv="content-security-policy"> (case-insensitive)
  | "no_default_src" // no directive exactly "default-src 'self'"
  | "no_script_src" // no directive named "script-src"
  | "script_src_unsafe_inline" // script-src, script-src-elem or script-src-attr holds 'unsafe-inline'
  | "unsafe_eval" // any directive holds 'unsafe-eval'
  | "style_src_not_relaxed" // no directive exactly "style-src 'self' 'unsafe-inline'"
  | "style_src_split"; // a style-src-elem or style-src-attr directive exists (it overrides the relaxed style-src)

export function relaxStyleSrc(html: string): string {
  return html.replace(STYLE_SRC, RELAXED_STYLE_SRC);
}

// Returns the first problem of one built page, or null when the page carries the CSP.
export function cspProblem(html: string): CspProblem | null {
  const metas = html.match(CSP_META_TAG) ?? [];
  if (metas.length !== 1) return "csp_meta_count";
  const content = META_CONTENT.exec(metas[0])?.[1] ?? "";
  const directives = content
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((text) => ({ text, name: text.split(/\s+/)[0] }));
  const hasToken = (text: string, token: string) => text.split(/\s+/).includes(token);

  if (!directives.some((d) => d.text === "default-src 'self'")) return "no_default_src";
  if (!directives.some((d) => d.name === "script-src")) return "no_script_src";
  if (directives.some((d) => SCRIPT_DIRECTIVES.has(d.name) && hasToken(d.text, "'unsafe-inline'"))) {
    return "script_src_unsafe_inline";
  }
  if (directives.some((d) => hasToken(d.text, "'unsafe-eval'"))) return "unsafe_eval";
  if (!directives.some((d) => d.text === STYLE_DIRECTIVE)) return "style_src_not_relaxed";
  if (directives.some((d) => STYLE_SPLIT_DIRECTIVES.has(d.name))) return "style_src_split";
  return null;
}

function* htmlFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (entry.endsWith(".html")) yield path;
  }
}

// Relaxes style-src in every .html file under dir (rewrites a changed file), then checks each page with cspProblem.
// Throws Error(`${problem} in ${relativePath}`) at the first bad page, Error("no html page in the build") when none exists.
export function checkDist(dir: string): { checked: number; relaxed: number } {
  let checked = 0;
  let relaxed = 0;
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    const next = relaxStyleSrc(html);
    if (next !== html) {
      writeFileSync(file, next);
      relaxed += 1;
    }
    const problem = cspProblem(next);
    if (problem) throw new Error(`${problem} in ${relative(dir, file)}`);
    checked += 1;
  }
  if (checked === 0) throw new Error("no html page in the build");
  return { checked, relaxed };
}

export default function cspStyleSrc(): AstroIntegration {
  return {
    name: "ea-csp-style-src",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const { checked, relaxed } = checkDist(fileURLToPath(dir));
        logger.info(`style-src relaxed in ${relaxed} page(s)`);
        logger.info(`csp checked in ${checked} page(s)`);
      },
    },
  };
}
