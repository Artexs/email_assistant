// The docs config wires the checks: each integration is there, in order, and reads what it must.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Hook = (arguments_: Record<string, unknown>) => void;
interface Integration {
  name: string;
  hooks: Record<string, Hook | undefined>;
}

const DOCS_ROOT = fileURLToPath(new URL("..", import.meta.url));
let fixture = "";
let integrations: Integration[] = [];
const saved = process.env.EA_DOCS_REPO_ROOT;

const put = (base: string, path: string, text: string) => {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), text);
};
const hook = (name: string, event: string): Hook => {
  const found = integrations.find((integration) => integration.name === name)?.hooks[event];
  if (!found) throw new Error(`no ${event} hook of ${name}`);
  return found;
};
const logger = () => {
  const lines: string[] = [];
  return { lines, logger: { info: (line: string) => void lines.push(line) } };
};

beforeAll(async () => {
  // A fixture repository whose in-place sources hold a script: the config must hand them to cspFinalize.
  fixture = mkdtempSync(join(tmpdir(), "docs-wiring-"));
  put(fixture, "deploy/README.md", "# Runbook\n<script>x()</script>\n");
  put(fixture, "docs/release-checklist.md", "# Checklist\n");
  put(fixture, "CHANGELOG.md", "# Changelog\n");
  process.env.EA_DOCS_REPO_ROOT = fixture;
  const config = (await import("../astro.config.mjs")).default as { integrations: Integration[] };
  integrations = config.integrations;
});
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (saved === undefined) delete process.env.EA_DOCS_REPO_ROOT;
  else process.env.EA_DOCS_REPO_ROOT = saved;
});

describe("astro.config.mjs", () => {
  test("the integrations run in this order: Starlight, CSP, public content, in-place pages, links, claims, images, shots, demo video", () => {
    expect(integrations.map((integration) => integration.name)).toEqual([
      "@astrojs/starlight",
      "ea-csp-finalize",
      "ea-public-content",
      "ea-in-place-check",
      "ea-link-check",
      "ea-claim-check",
      "ea-image-check",
      "ea-shots",
      "ea-demo-video",
    ]);
  });
  test("the shots integration tells <Shot> where the PNG files are and logs the mode once", () => {
    const saved = { dir: process.env.EA_DOCS_SHOTS_DIR, mode: process.env.DOCS_SHOTS };
    try {
      delete process.env.EA_DOCS_SHOTS_DIR;
      delete process.env.DOCS_SHOTS;
      const run = hook("ea-shots", "astro:config:done");
      const off = logger();
      run({ config: { root: pathToFileURL(`${DOCS_ROOT}/`) }, logger: off.logger });
      expect(off.lines).toEqual(["shots: off"]);
      // `delete` narrows the type to undefined for the compiler: the cast keeps what `run` wrote.
      expect(process.env.EA_DOCS_SHOTS_DIR as string | undefined).toBe(join(DOCS_ROOT, "public/shots"));
      process.env.DOCS_SHOTS = "on";
      const on = logger();
      run({ config: { root: pathToFileURL(`${DOCS_ROOT}/`) }, logger: on.logger });
      expect(on.lines).toEqual(["shots: on"]);
    } finally {
      if (saved.dir === undefined) delete process.env.EA_DOCS_SHOTS_DIR;
      else process.env.EA_DOCS_SHOTS_DIR = saved.dir;
      if (saved.mode === undefined) delete process.env.DOCS_SHOTS;
      else process.env.DOCS_SHOTS = saved.mode;
    }
  });
  test("the demo video integration points <DemoVideo> at the public folder and logs the mode once", () => {
    const saved = process.env.EA_DOCS_DEMO_DIR;
    const folder = mkdtempSync(join(tmpdir(), "docs-wiring-public-"));
    try {
      delete process.env.EA_DOCS_DEMO_DIR;
      const run = hook("ea-demo-video", "astro:config:done");
      const off = logger();
      run({ config: { publicDir: pathToFileURL(`${folder}/`) }, logger: off.logger });
      expect(off.lines).toEqual(["demo_video: off"]);
      expect(process.env.EA_DOCS_DEMO_DIR as string | undefined).toBe(join(folder, "demo"));
      for (const name of ["demo.mp4", "demo.en.vtt", "demo.pl.vtt"]) put(folder, `demo/${name}`, "x");
      const on = logger();
      run({ config: { publicDir: pathToFileURL(`${folder}/`) }, logger: on.logger });
      expect(on.lines).toEqual(["demo_video: on"]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
      if (saved === undefined) delete process.env.EA_DOCS_DEMO_DIR;
      else process.env.EA_DOCS_DEMO_DIR = saved;
    }
  });
  test("the content-script check reads the in-place sources", () => {
    const setup = hook("ea-csp-finalize", "astro:config:setup");
    expect(() => setup({ config: { root: pathToFileURL(`${DOCS_ROOT}/`) } })).toThrow(
      /content_script .*deploy\/README\.md:2/
    );
  });
  test("the link check runs after the build and fails on a broken link", () => {
    const dist = mkdtempSync(join(tmpdir(), "docs-wiring-dist-"));
    try {
      const run = hook("ea-link-check", "astro:build:done");
      put(dist, "index.html", `<html><body><a href="/email_assistant/nope/">n</a></body></html>`);
      expect(() => run({ dir: pathToFileURL(`${dist}/`), logger: logger().logger })).toThrow(
        "broken_link /email_assistant/nope/ in index.html"
      );
      put(dist, "index.html", `<html><body><a href="#a" id="a">n</a></body></html>`);
      const { lines, logger: log } = logger();
      run({ dir: pathToFileURL(`${dist}/`), logger: log });
      expect(lines).toEqual(["links checked in 1 page(s)"]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
  test("the image check runs after the build and fails on an image outside the allowed places", () => {
    const dist = mkdtempSync(join(tmpdir(), "docs-wiring-dist-"));
    try {
      const run = hook("ea-image-check", "astro:build:done");
      put(dist, "index.html", `<html><body><img src="/email_assistant/other.png"></body></html>`);
      expect(() => run({ dir: pathToFileURL(`${dist}/`), logger: logger().logger })).toThrow(
        "image_outside /email_assistant/other.png in index.html"
      );
      put(dist, "index.html", `<html><body><img src="/email_assistant/shots/a.png"></body></html>`);
      const { lines, logger: log } = logger();
      run({ dir: pathToFileURL(`${dist}/`), logger: log });
      expect(lines).toEqual(["image sources checked: 1"]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
  test("the in-place check runs after the build and fails on a missing page", () => {
    const dist = mkdtempSync(join(tmpdir(), "docs-wiring-dist-"));
    try {
      expect(() =>
        hook("ea-in-place-check", "astro:build:done")({ dir: pathToFileURL(`${dist}/`), logger: logger().logger })
      ).toThrow("in_place_page operate/install-and-run: missing");
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
