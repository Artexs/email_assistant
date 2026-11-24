import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { createCliOutput } from "../../server/src/platform/cli";

// `bun run --filter @ea/web icons`: draws the PNG files of the brand from `brand/mark.svg` with the Chromium of Playwright. The files
// are committed; the build does not run this script. Run it after a change of the SVG, then check that `pwa-shell.test.ts` passes.
const out = createCliOutput("web-build-icons");
const root = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(join(root, "brand/mark.svg"), "utf8");
const teal = /id="tile" fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
if (teal === undefined) {
  out.fail("brand/mark.svg has no tile fill");
  process.exit(1);
}

// "tile": the shape of the mark, transparent outside it. "square": a full teal square with the envelope at the same size; the
// maskable icon and the iOS icon need it (a mask or a black corner would cut or paint a transparent edge). The envelope spans 50 % of
// the side, inside the 60 % safe zone of a maskable icon.
type Shape = "tile" | "square";
const files: { path: string; size: number; shape: Shape }[] = [
  { path: "public/favicon.png", size: 32, shape: "tile" },
  { path: "public/icons/icon-192.png", size: 192, shape: "tile" },
  { path: "public/icons/icon-512.png", size: 512, shape: "tile" },
  { path: "public/icons/icon-512-maskable.png", size: 512, shape: "square" },
  { path: "public/icons/apple-touch-icon.png", size: 180, shape: "square" },
];

function pageFor(size: number, shape: Shape): string {
  const hideTile = shape === "square" ? "#tile{display:none}" : "";
  const ground = shape === "square" ? teal : "transparent";
  return `<!doctype html><style>html,body{margin:0;background:${ground}}svg{display:block;width:${size}px;height:${size}px}${hideTile}</style>${svg}`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const file of files) {
    await page.setViewportSize({ width: file.size, height: file.size });
    await page.setContent(pageFor(file.size, file.shape));
    await page.screenshot({ path: join(root, file.path), omitBackground: file.shape === "tile" });
    out.print(`${file.path} written (${file.size} px, ${file.shape})`);
  }
} finally {
  await browser.close();
}
