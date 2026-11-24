import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// The installable shell: the files that make the panel installable and the rules around them. The worker logic has its own test
// (`src/lib/service-worker.test.ts`); the served headers are in `apps/server/test/integration/web-http-pages.test.ts`.
const web = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(web, path), "utf8");

interface Manifest {
  start_url: string;
  theme_color: string;
  background_color: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(join(web, path));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// The light tokens are the first `:root` block of `global.css`; the dark ones follow in the colour-scheme media query.
function token(scheme: "light" | "dark", name: string): string {
  const css = read("src/styles/global.css");
  const dark = css.indexOf("@media (prefers-color-scheme: dark)");
  const block = scheme === "light" ? css.slice(css.indexOf(":root"), dark) : css.slice(dark);
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1];
  if (value === undefined) throw new Error(`global.css has no ${scheme} token --${name}`);
  return value;
}

describe("manifest", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as Manifest;

  test("4. it starts at /activity, in standalone mode, with the scope of the whole panel", () => {
    expect(manifest.start_url).toBe("/activity");
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
  });

  test("it lists the 192 and 512 icons and a 512 maskable icon; every file exists with the size that the manifest states", () => {
    const sized = manifest.icons.map((icon) => [icon.sizes, icon.purpose ?? "any"]);
    expect(sized).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/icons/")).toBe(true);
      expect(pngSize(`public${icon.src}`)).toEqual({ width, height });
    }
  });
});

describe("the brand colours", () => {
  test("the manifest uses the light primary for the theme and the light background for the splash screen", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as Manifest;
    expect(manifest.theme_color).toBe(token("light", "primary"));
    expect(manifest.background_color).toBe(token("light", "background"));
  });

  test.each(["src/layouts/App.astro", "src/layouts/Public.astro"])(
    "%s holds one theme-color per scheme: the light primary and the dark background",
    (layout) => {
      const tags = [...read(layout).matchAll(/<meta name="theme-color" media="([^"]+)" content="([^"]+)" \/>/g)].map(
        (match) => [match[1], match[2]]
      );
      expect(tags).toEqual([
        ["(prefers-color-scheme: light)", token("light", "primary")],
        ["(prefers-color-scheme: dark)", token("dark", "background")],
      ]);
      expect(read(layout).match(/name="theme-color"/g)).toHaveLength(2);
    }
  );

  test("both layouts link the 180 px apple touch icon, which is a full square", () => {
    for (const layout of ["src/layouts/App.astro", "src/layouts/Public.astro"]) {
      expect(read(layout)).toContain(`<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />`);
    }
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});

describe("the page", () => {
  test("the CSP names the worker and the manifest explicitly (worker-src would otherwise fall back to the hashed script-src)", () => {
    const config = read("astro.config.mjs");
    expect(config).toContain(`"worker-src 'self'"`);
    expect(config).toContain(`"manifest-src 'self'"`);
  });

  test("both layouts link the manifest; the panel layout registers the worker; the build bundles it after astro", () => {
    for (const layout of ["src/layouts/App.astro", "src/layouts/Public.astro"]) {
      expect(read(layout)).toContain(`<link rel="manifest" href="/manifest.webmanifest" />`);
    }
    expect(read("src/layouts/App.astro")).toContain(`import "../lib/register-sw";`);
    expect(read("src/lib/register-sw.ts")).toContain(`register("/sw.js", { scope: "/" })`);
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.build).toBe("astro build && bun scripts/build-sw.ts");
  });
});

describe("the worker bundle", () => {
  test("it is one file with no import left, and it holds the push code, the offline code and the files of the build", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "ea-sw-"));
    try {
      const result = await Bun.build({
        entrypoints: [join(web, "src/sw/sw.ts")],
        outdir,
        naming: "sw.js",
        target: "browser",
        format: "esm",
        minify: true,
        define: { __EA_SHELL__: JSON.stringify({ assets: ["/_astro/a.css"], version: "v2-00000000" }) },
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const code = readFileSync(join(outdir, "sw.js"), "utf8");
      expect(code).toContain("showNotification");
      expect(code).toContain("/offline.html");
      expect(code).toContain("/_astro/a.css");
      expect(code).toContain("ea-shell-");
      expect(code).toContain("v2-00000000");
      expect(code).not.toMatch(/(^|[;}])import[\s{"']/);
      expect(code).not.toContain("node:");
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
