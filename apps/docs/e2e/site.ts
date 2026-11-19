import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DOCS_BASE } from "@ea/core";

import { docsTestPort, loadRepoDotEnv } from "../../server/src/scripts/e2e-job-env-args";

// The repo `.env` loads at import, so a job `.env` can set `DOCS_TEST_PORT`. A key that is already set wins over the file.
loadRepoDotEnv(join(import.meta.dirname, "../../.."));

// Shared by `serve.ts`, the Playwright config and the spec. The port is `DOCS_TEST_PORT`, else 8093 (next to the panel e2e ports 8081 and 8092).
export const DOCS_TEST_PORT = docsTestPort(process.env);
export const DOCS_TEST_HOST = "127.0.0.1";
// `EA_DOCS_DIST_DIR` points the checks at another folder (tests only).
export const DOCS_DIST = process.env.EA_DOCS_DIST_DIR ?? join(import.meta.dirname, "../dist");

// The origin of the local server for the env of this moment. The Playwright config calls it in its own body: Bun caches this
// module across cache-busted config imports, so a constant would keep the first port.
export function docsLocalOrigin(env: Record<string, string | undefined>): string {
  return `http://${DOCS_TEST_HOST}:${docsTestPort(env)}`;
}
export const DOCS_LOCAL_ORIGIN = docsLocalOrigin(process.env);

// Env `DOCS_TEST_URL`: a site that is already published (an origin, no path). The tests open it instead of the local server.
export function docsTestOrigin(): string {
  const url = process.env.DOCS_TEST_URL?.trim();
  return url ? url.replace(/\/+$/, "") : docsLocalOrigin(process.env);
}

export function distIsBuilt(dist: string = DOCS_DIST): boolean {
  return existsSync(join(dist, "index.html"));
}

// The URL paths of the built pages, read from the `.html` files: `index.html` files end in `/`. `404.html` is no page of the site.
export function builtPagePaths(dist: string = DOCS_DIST): string[] {
  const paths: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name === "index.html") paths.push(`${DOCS_BASE}/${prefix}`);
      else if (entry.name.endsWith(".html") && entry.name !== "404.html")
        paths.push(`${DOCS_BASE}/${prefix}${entry.name}`);
    }
  };
  walk(dist, "");
  return paths.sort();
}
