// Astro integration: after the build, check every text file of the built site for private data and third-party assets
// (rules R1 to R7 in `@ea/core/web` `public-content.ts`, plan D4). The allow list `public-content-allow.txt` holds
// `<exact string> | <reason>` lines; an entry that no file needs fails the build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowList, publicContentScan } from "@ea/core/web";
import type { AstroIntegration } from "astro";

const TEXT_SUFFIXES = [".html", ".xml", ".txt", ".json", ".css", ".js", ".svg", ".webmanifest"];
// The Pagefind index and its runtime are generated, not authored; they are outside the check.
const SKIPPED_TOP_FOLDER = "pagefind";

function* publicFiles(dir: string, top = true): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!(top && entry === SKIPPED_TOP_FOLDER)) yield* publicFiles(path, false);
    } else if (TEXT_SUFFIXES.some((suffix) => entry.endsWith(suffix))) yield path;
  }
}

// Throws Error(`public_content ${rule} in ${file}: ${match}`) at the first problem, Error(`unused_allow ${entry}`) for
// an allow entry no file needed, Error("no public file in the build") when nothing was checked.
export function checkPublicContent(dir: string, allow: readonly string[]): { checked: number } {
  let checked = 0;
  const used = new Set<string>();
  for (const file of publicFiles(dir)) {
    const scan = publicContentScan(readFileSync(file, "utf8"), allow);
    const first = scan.problems[0];
    if (first) throw new Error(`public_content ${first.rule} in ${relative(dir, file)}: ${first.match}`);
    for (const entry of scan.used) used.add(entry);
    checked += 1;
  }
  if (checked === 0) throw new Error("no public file in the build");
  const unused = allow.find((entry) => !used.has(entry));
  if (unused !== undefined) throw new Error(`unused_allow ${unused}`);
  return { checked };
}

export default function publicContent(): AstroIntegration {
  let root = "";
  return {
    name: "ea-public-content",
    hooks: {
      "astro:config:done": ({ config }) => {
        root = fileURLToPath(config.root);
      },
      "astro:build:done": ({ dir, logger }) => {
        const allow = parseAllowList(readFileSync(join(root, "public-content-allow.txt"), "utf8"));
        const { checked } = checkPublicContent(fileURLToPath(dir), allow);
        logger.info(`public content checked in ${checked} file(s)`);
      },
    },
  };
}
