import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

import { DOCS_BASE } from "@ea/core";

import { createCliOutput } from "../../server/src/platform/cli";
import { docsTestPort } from "../../server/src/scripts/e2e-job-env-args";
import { DOCS_DIST, DOCS_TEST_HOST } from "./site";

// A static server for `apps/docs/dist` under `DOCS_BASE`, as GitHub Pages serves it: a path that ends in `/` answers with its
// `index.html`, everything else that is not a file answers 404 with `404.html`. It sets no header: the CSP is the page's own meta tag.
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot < 0 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? "application/octet-stream";
}

function notFound(dist: string): Response {
  const page = join(dist, "404.html");
  return new Response(existsSync(page) ? Bun.file(page) : "not found", {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Maps a URL path to a file in `dist`, or undefined. Nothing outside `dist` is served.
export function fileForPath(dist: string, pathname: string): string | undefined {
  if (pathname !== DOCS_BASE && !pathname.startsWith(`${DOCS_BASE}/`)) return undefined;
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(DOCS_BASE.length));
  } catch {
    return undefined;
  }
  if (relative.includes("\0")) return undefined;
  const target = normalize(
    join(dist, relative.endsWith("/") || relative === "" ? join(relative, "index.html") : relative)
  );
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) return undefined;
  return existsSync(target) && statSync(target).isFile() ? target : undefined;
}

export function handle(request: Request, dist: string = DOCS_DIST): Response {
  const file = fileForPath(dist, new URL(request.url).pathname);
  if (file === undefined) return notFound(dist);
  return new Response(Bun.file(file), { headers: { "content-type": contentType(file) } });
}

if (import.meta.main) {
  const out = createCliOutput("docs-serve");
  if (!existsSync(join(DOCS_DIST, "index.html"))) {
    out.fail("apps/docs/dist/index.html is missing: run `bun run docs:build` first");
    process.exit(1);
  }
  const server = Bun.serve({
    hostname: DOCS_TEST_HOST,
    port: docsTestPort(process.env),
    fetch: (request) => handle(request),
  });
  out.print(`serving ${DOCS_DIST} at http://${DOCS_TEST_HOST}:${server.port}${DOCS_BASE}/`);
}
