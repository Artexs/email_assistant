// Astro integration: after the build, every image source of every page must point at a file the site owns (ADR 0030 point 4: an
// image is a screenshot of the shot run, never one added by hand). A source passes when it is a `data:` URI or a same-site path
// in the shots folder, in Starlight's own assets (`_astro/`), `favicon.svg` or `public/brand/`. Any other source fails the build with
// `image_outside <src> in <page>`.
// Sources read: `<img src>`, every `srcset` entry, `<source src|srcset>`, `<video poster>`, an icon `<link href>`, `og:image` and
// `twitter:image` `<meta content>`, and CSS `url()` of an image type (CSS files, `<style>` text and `style` attributes).
// The demo video files are media, not images: `.mp4` and `.vtt` are ignored.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_BASE } from "@ea/core";
import type { AstroIntegration } from "astro";

import { ATTRIBUTE, htmlFiles, RAW_TEXT_ELEMENT, TAG } from "./link-check";

const PLACEHOLDER_ORIGIN = "http://page.invalid";
const MEDIA_FILE = /\.(mp4|vtt)$/i;
const IMAGE_TYPE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|apng|tiff?)$/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi;
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const ICON_REL = /(^|\s)(icon|shortcut|apple-touch-icon|mask-icon|image_src)(\s|$)/i;
const IMAGE_META = /^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/i;

// The site folders and files an image may come from (under the site base).
const ALLOWED_FOLDERS = ["shots", "_astro", "brand"] as const;
const ALLOWED_FILES = ["favicon.svg"] as const;

// The image sources of an HTML page, in page order.
export function imageSources(html: string): string[] {
  const sources: string[] = [];
  const text = (value: string | undefined): string => (value ?? "").replaceAll("&amp;", "&");
  for (const style of html.matchAll(STYLE_ELEMENT)) sources.push(...cssImageSources(style[1] ?? ""));
  for (const tag of html
    .replace(RAW_TEXT_ELEMENT, (element) => element.slice(0, element.indexOf(">") + 1))
    .matchAll(TAG)) {
    const name = (tag[1] ?? "").toLowerCase();
    const attributes = new Map<string, string>();
    for (const attribute of (tag[2] ?? "").matchAll(ATTRIBUTE)) {
      attributes.set((attribute[1] ?? "").toLowerCase(), text(attribute[2] ?? attribute[3] ?? attribute[4]));
    }
    const take = (key: string): void => {
      const value = attributes.get(key);
      if (value !== undefined) sources.push(value);
    };
    const takeSrcset = (): void => {
      for (const entry of (attributes.get("srcset") ?? "").split(",")) {
        const url = entry.trim().split(/\s+/)[0];
        if (url !== undefined && url !== "") sources.push(url);
      }
    };
    if (name === "img") {
      take("src");
      takeSrcset();
    } else if (name === "source") {
      take("src");
      takeSrcset();
    } else if (name === "video") take("poster");
    else if (name === "link" && ICON_REL.test(attributes.get("rel") ?? "")) take("href");
    else if (name === "meta" && IMAGE_META.test(attributes.get("property") ?? attributes.get("name") ?? ""))
      take("content");
    const style = attributes.get("style");
    if (style !== undefined) sources.push(...cssImageSources(style));
  }
  return sources.filter((source) => source !== "");
}

// The `url()` values of a style text that name an image (a font or another file type is not an image).
export function cssImageSources(css: string): string[] {
  const sources: string[] = [];
  for (const match of css.matchAll(CSS_URL)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value === "" || value.startsWith("data:")) continue;
    if (IMAGE_TYPE.test(value.split(/[?#]/)[0] ?? "")) sources.push(value);
  }
  return sources;
}

// True when the source is a file this site owns. `from` is the site path of the page (under the base).
export function imageAllowed(source: string, from: string, base: string = DOCS_BASE): boolean {
  if (source.startsWith("data:")) return true;
  let url: URL;
  try {
    url = new URL(source, `${PLACEHOLDER_ORIGIN}${base}/${from}`);
  } catch {
    return false;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return false;
  if (MEDIA_FILE.test(url.pathname)) return true;
  const path = url.pathname;
  if (ALLOWED_FILES.some((file) => path === `${base}/${file}`)) return true;
  return ALLOWED_FOLDERS.some((folder) => path.startsWith(`${base}/${folder}/`));
}

function* cssFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* cssFiles(path);
    else if (entry.endsWith(".css")) yield path;
  }
}

// Throws Error(`image_outside ${src} in ${page}`) at the first image source outside the allowed places.
export function checkImages(dir: string, base: string = DOCS_BASE): { checked: number } {
  let checked = 0;
  const verify = (sources: string[], file: string): void => {
    for (const source of sources) {
      checked += 1;
      // A CSS file resolves a relative `url()` against its own folder; a page, against its own path.
      if (!imageAllowed(source, file, base)) throw new Error(`image_outside ${source} in ${file}`);
    }
  };
  for (const page of htmlFiles(dir)) verify(imageSources(readFileSync(page, "utf8")), relative(dir, page));
  for (const sheet of cssFiles(dir)) verify(cssImageSources(readFileSync(sheet, "utf8")), relative(dir, sheet));
  return { checked };
}

export default function imageCheck(): AstroIntegration {
  return {
    name: "ea-image-check",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const { checked } = checkImages(fileURLToPath(dir));
        logger.info(`image sources checked: ${checked}`);
      },
    },
  };
}
