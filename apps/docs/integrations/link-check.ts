// Astro integration: after the build, every same-site link of every page must resolve.
// A same-site link is an `href` or `src` that is relative or starts with the site base. An absolute URL, also one to the
// site address (the canonical link of the 404 page names a path that is the file `404.html`), counts as another origin.
// An absolute URL that does not parse is broken.
// It must resolve to a built file (`<path>`, `<path>/index.html` or `<path>.html`); a `#id` must match an `id` on the target page.
// Links to other origins are not fetched.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_BASE } from "@ea/core";
import type { AstroIntegration } from "astro";

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const RAW_TEXT_ELEMENT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const PLACEHOLDER_ORIGIN = "http://page.invalid";

interface PageLinks {
  links: string[];
  ids: Set<string>;
}

// The `href` and `src` values and the `id` values of the tags of a page. Script and style bodies are skipped.
export function pageLinks(html: string): PageLinks {
  const links: string[] = [];
  const ids = new Set<string>();
  for (const tag of html
    .replace(RAW_TEXT_ELEMENT, (element) => element.slice(0, element.indexOf(">") + 1))
    .matchAll(TAG)) {
    for (const attribute of (tag[2] ?? "").matchAll(ATTRIBUTE)) {
      const name = (attribute[1] ?? "").toLowerCase();
      const value = (attribute[2] ?? attribute[3] ?? attribute[4] ?? "").replaceAll("&amp;", "&");
      if (name === "href" || name === "src") links.push(value);
      else if (name === "id" || (name === "name" && tag[1]?.toLowerCase() === "a")) ids.add(value);
    }
  }
  return { links, ids };
}

function* htmlFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (entry.endsWith(".html")) yield path;
  }
}

// The built file for a site path (under the base, without it), or null.
function builtFile(dir: string, sitePath: string): string | null {
  const rel = sitePath.replace(/^\/+/, "");
  const candidates = [join(dir, rel), join(dir, rel, "index.html"), join(dir, `${rel}.html`)];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

// Throws Error(`broken_link ${href} in ${page}`) at the first broken link, Error("no html page in the build") when none exists.
export function checkLinks(dir: string, base: string = DOCS_BASE): { checked: number } {
  const pages = [...htmlFiles(dir)];
  if (pages.length === 0) throw new Error("no html page in the build");
  const parsed = new Map<string, PageLinks>();
  const read = (file: string): PageLinks => {
    let links = parsed.get(file);
    if (!links) {
      links = pageLinks(readFileSync(file, "utf8"));
      parsed.set(file, links);
    }
    return links;
  };
  for (const page of pages) {
    const pageName = relative(dir, page);
    const pageUrl = `${PLACEHOLDER_ORIGIN}${base}/${pageName}`;
    for (const href of read(page).links) {
      const broken = () => new Error(`broken_link ${href} in ${pageName}`);
      let url: URL;
      try {
        url = new URL(href, pageUrl);
      } catch {
        throw broken();
      }
      if (url.origin !== PLACEHOLDER_ORIGIN) continue;
      if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) throw broken();
      const sitePath = decodeURIComponent(url.pathname.slice(base.length)) || "/";
      const target = builtFile(dir, sitePath);
      if (target === null) throw broken();
      const id = decodeURIComponent(url.hash.slice(1));
      if (id !== "" && id !== "top" && target.endsWith(".html") && !read(target).ids.has(id)) throw broken();
    }
  }
  return { checked: pages.length };
}

export default function linkCheck(): AstroIntegration {
  return {
    name: "ea-link-check",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const { checked } = checkLinks(fileURLToPath(dir));
        logger.info(`links checked in ${checked} page(s)`);
      },
    },
  };
}
