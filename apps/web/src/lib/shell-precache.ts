import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { OFFLINE_PATH, SW_VERSION, type ShellFiles } from "./service-worker";

// The build step behind the offline page of the service worker: which files the page needs, and the version of that set. It runs in the
// build (`scripts/build-sw.ts`), never in the worker, so the worker holds a finished list and parses no HTML at install.

const ASTRO_PREFIX = "/_astro/";

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** The `/_astro/` files that the page links (style sheets, scripts, preloads). */
function linkedFiles(html: string): string[] {
  const files: string[] = [];
  for (const [tag] of html.matchAll(/<(?:link|script)\b[^>]*>/gi)) {
    const target = attribute(tag, "href") ?? attribute(tag, "src");
    if (target?.startsWith(ASTRO_PREFIX)) files.push(target);
  }
  return files;
}

/** The `/_astro/` files that a style sheet names in `url(...)`: the fonts. `http:` and `data:` addresses are not ours. */
function cssFiles(css: string): string[] {
  const files: string[] = [];
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    if (target.startsWith(ASTRO_PREFIX)) files.push(target);
  }
  return files;
}

const pathOf = (target: string): string => target.replace(/[?#].*$/, "");

/**
 * The sorted list of the `/_astro/` files that the offline page needs: the files it links, then the files that its style sheets name.
 * `cssByPath` holds the text of each style sheet the page links, by its path. A style sheet that is missing there adds no file.
 */
export function offlineAssets(html: string, cssByPath: Record<string, string>): string[] {
  const assets = new Set<string>();
  for (const target of linkedFiles(html)) {
    const path = pathOf(target);
    assets.add(path);
    const css = cssByPath[path];
    if (css !== undefined) for (const font of cssFiles(css)) assets.add(pathOf(font));
  }
  return [...assets].sort();
}

/** `v2-` and 8 hex characters of a hash over the path and the bytes of each file, whatever the order of the list. */
export function shellVersion(files: readonly { path: string; bytes: Uint8Array }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`${file.path}\0`);
    hash.update(file.bytes);
    hash.update("\0");
  }
  return `${SW_VERSION}-${hash.digest("hex").slice(0, 8)}`;
}

/** Reads the built offline page and its files from `dist`. It throws when the page links no style sheet or a listed file is missing. */
export function readShell(dist: string): ShellFiles {
  // Astro writes `offline.html.astro` as a folder with an `index.html`; the server answers `/offline.html` from either form.
  const pagePath = [join(dist, OFFLINE_PATH), join(dist, OFFLINE_PATH, "index.html")].find(
    (path) => existsSync(path) && statSync(path).isFile()
  );
  if (pagePath === undefined) throw new Error(`${OFFLINE_PATH} is missing in ${dist}`);
  const pageBytes = readFileSync(pagePath);
  const html = pageBytes.toString("utf8");

  const sheets = linkedFiles(html)
    .map(pathOf)
    .filter((path) => path.endsWith(".css"));
  if (sheets.length === 0) throw new Error(`${OFFLINE_PATH} links no style sheet`);

  const cssByPath: Record<string, string> = {};
  for (const path of sheets) {
    const file = join(dist, path);
    if (!existsSync(file)) throw new Error(`style sheet ${path} is missing in ${dist}`);
    cssByPath[path] = readFileSync(file, "utf8");
  }

  const assets = offlineAssets(html, cssByPath);
  const files = [{ path: OFFLINE_PATH, bytes: new Uint8Array(pageBytes) }];
  for (const path of assets) {
    const file = join(dist, path);
    if (!existsSync(file)) throw new Error(`listed file ${path} is missing in ${dist}`);
    files.push({ path, bytes: new Uint8Array(readFileSync(file)) });
  }
  return { assets, version: shellVersion(files) };
}
