// Astro integration: after the build, every in-place page must exist, show its source title as the page heading
// and be listed in the sidebar, in the section "Operate" unless the page has its own link. It catches a loader or sidebar that the config no longer wires.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import {
  IN_PLACE_PAGES,
  IN_PLACE_SECTION,
  inOperate,
  type InPlacePage,
  inPlaceSitePath,
  readInPlaceSource,
  repoRoot,
} from "../src/in-place";

const H1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const ANCHOR = /<a\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function headingText(html: string): string | null {
  const heading = H1.exec(html)?.[1];
  if (heading === undefined) return null;
  return heading.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

// Throws Error(`in_place_page ${id}: missing | title | sidebar | section`) at the first problem.
export function checkInPlacePages(
  dir: string,
  pages: readonly InPlacePage[] = IN_PLACE_PAGES,
  root: string = repoRoot()
): { checked: number } {
  for (const page of pages) {
    const file = join(dir, page.id, "index.html");
    if (!existsSync(file)) throw new Error(`in_place_page ${page.id}: missing`);
    const html = readFileSync(file, "utf8");
    if (headingText(html) !== readInPlaceSource(page, root).title) throw new Error(`in_place_page ${page.id}: title`);
    const href = `href="${inPlaceSitePath(page.id)}"`;
    const listed = [...html.matchAll(ANCHOR)].some(
      (anchor) => anchor[0].includes(href) && anchor[0].includes('aria-current="page"')
    );
    if (!listed) throw new Error(`in_place_page ${page.id}: sidebar`);
    if (inOperate(page) && !html.includes(`>${IN_PLACE_SECTION}<`))
      throw new Error(`in_place_page ${page.id}: section`);
  }
  return { checked: pages.length };
}

export default function inPlaceCheck(): AstroIntegration {
  return {
    name: "ea-in-place-check",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const { checked } = checkInPlacePages(fileURLToPath(dir));
        logger.info(`in-place pages checked: ${checked}`);
      },
    },
  };
}
