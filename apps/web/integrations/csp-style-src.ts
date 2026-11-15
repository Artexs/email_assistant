// Astro integration: after the build, replace the hashed `style-src` of every page's CSP meta with
// `style-src 'self' 'unsafe-inline'`, then check that every page still carries the ADR 0016 CSP.
// Radix overlays inject a scroll-lock <style> whose text varies with the scrollbar width, so no fixed hash exists;
// a hash in the list makes browsers ignore 'unsafe-inline'. Scripts stay hashed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cspProblem, STYLE_DIRECTIVE } from "@ea/core/web";
import type { AstroIntegration } from "astro";

export const STYLE_SRC = /style-src [^;"]*;?/;
export const RELAXED_STYLE_SRC = `${STYLE_DIRECTIVE};`;

export function relaxStyleSrc(html: string): string {
  return html.replace(STYLE_SRC, RELAXED_STYLE_SRC);
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
