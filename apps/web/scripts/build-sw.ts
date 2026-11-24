import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCliOutput } from "../../server/src/platform/cli";
import { readShell } from "../src/lib/shell-precache";

// Step two of `web:build`: bundles the service worker into `dist/sw.js` (after `astro build`). The bundle is one file with no import at
// run time; the server serves it from `WEB_DIST` like any other static file. The files of the offline page and their hash go into the
// bundle as `__EA_SHELL__`: a new text or a new file makes a new cache name.
const out = createCliOutput("web-build-sw");
const root = fileURLToPath(new URL("..", import.meta.url));

let shell;
try {
  shell = readShell(join(root, "dist"));
} catch (error) {
  out.fail(error instanceof Error ? error.message : "the offline page cannot be read");
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: [join(root, "src/sw/sw.ts")],
  outdir: join(root, "dist"),
  naming: "sw.js",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "none",
  define: { __EA_SHELL__: JSON.stringify(shell) },
});
if (!result.success) {
  for (const log of result.logs) out.fail(String(log));
  process.exit(1);
}
out.print(
  `sw.js written (${statSync(join(root, "dist/sw.js")).size} bytes), cache ${shell.version}, ${shell.assets.length} files`
);
