import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WCAG_TAGS } from "../e2e/a11y";
import { docsTestPort } from "../../server/src/scripts/e2e-job-env-args";
import { builtPagePaths, distIsBuilt, DOCS_LOCAL_ORIGIN, DOCS_TEST_PORT, docsTestOrigin } from "../e2e/site";
import { fileForPath, handle } from "../e2e/serve";

// The browser check of the built site: its static server, its page list and its wiring. The browser run is `bun run docs:test`.
const ROOT = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
let dist = "";

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "docs-dist-"));
  for (const dir of ["pl", "operate/run", "_astro"]) mkdirSync(join(dist, dir), { recursive: true });
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, "404.html"), "not-found-page");
  writeFileSync(join(dist, "pl/index.html"), "pl-home");
  writeFileSync(join(dist, "operate/run/index.html"), "run");
  writeFileSync(join(dist, "_astro/app.js"), "x");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>");
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const get = (path: string) => handle(new Request(`http://127.0.0.1:8093${path}`), dist);

describe("serve.ts", () => {
  test("a path that ends in / answers with its index.html, under the base", async () => {
    for (const [path, body] of [
      ["/email_assistant/", "home"],
      ["/email_assistant", "home"],
      ["/email_assistant/pl/", "pl-home"],
      ["/email_assistant/operate/run/", "run"],
    ] as const) {
      const response = get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    }
  });

  test("a file answers with its type", () => {
    expect(get("/email_assistant/_astro/app.js").headers.get("content-type")).toContain("text/javascript");
    expect(get("/email_assistant/favicon.svg").headers.get("content-type")).toBe("image/svg+xml");
    expect(get("/email_assistant/").headers.get("content-type")).toContain("text/html");
  });

  test("a path with no file answers 404 with 404.html, also without the trailing slash", async () => {
    for (const path of [
      "/email_assistant/nope/",
      "/email_assistant/operate/run",
      "/email_assistant/pl",
      "/elsewhere/",
      "/",
    ]) {
      const response = get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("not-found-page");
    }
  });

  test("nothing outside the folder is served", () => {
    expect(fileForPath(dist, "/email_assistant/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    expect(fileForPath(dist, "/email_assistant/..%2fpackage.json")).toBeUndefined();
    expect(fileForPath(dist, "/email_assistant/%00")).toBeUndefined();
    expect(fileForPath(dist, "/email_assistant/%E0%A4%A")).toBeUndefined();
  });

  test("the process refuses to start without a build, and names the command", () => {
    const empty = mkdtempSync(join(tmpdir(), "docs-empty-"));
    try {
      const result = Bun.spawnSync(["bun", join(ROOT, "apps/docs/e2e/serve.ts")], {
        env: { ...process.env, EA_DOCS_DIST_DIR: empty },
        timeout: 10_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("[docs-serve]");
      expect(result.stderr.toString()).toContain("run `bun run docs:build` first");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("the spec fails at once, with the build command, when there is no build (a DOCS_TEST_URL run starts no server)", () => {
    const empty = mkdtempSync(join(tmpdir(), "docs-empty-"));
    try {
      const result = Bun.spawnSync(["bunx", "playwright", "test", "-c", "apps/docs/e2e/playwright.config.ts"], {
        cwd: ROOT,
        env: { ...process.env, EA_DOCS_DIST_DIR: empty, DOCS_TEST_URL: "https://example.test" },
        timeout: 25_000,
      });
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "dist/index.html is missing: run `bun run docs:build` before `bun run docs:test`"
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("the page list", () => {
  test("comes from the .html files: index files end in /, 404.html and other folders' assets are no page", () => {
    expect(builtPagePaths(dist)).toEqual([
      "/email_assistant/",
      "/email_assistant/operate/run/",
      "/email_assistant/pl/",
    ]);
  });

  test("a folder with a loose .html file lists the file", () => {
    writeFileSync(join(dist, "loose.html"), "x");
    expect(builtPagePaths(dist)).toContain("/email_assistant/loose.html");
    rmSync(join(dist, "loose.html"));
  });

  test("distIsBuilt needs index.html", () => {
    expect(distIsBuilt(dist)).toBe(true);
    expect(distIsBuilt(join(dist, "pl", "none"))).toBe(false);
  });

  test("DOCS_TEST_URL replaces the local origin, without a trailing slash", () => {
    const before = process.env.DOCS_TEST_URL;
    try {
      delete process.env.DOCS_TEST_URL;
      expect(docsTestOrigin()).toBe(`http://127.0.0.1:${DOCS_TEST_PORT}`);
      expect(docsTestOrigin()).toBe(DOCS_LOCAL_ORIGIN);
      process.env.DOCS_TEST_URL = "https://example.test/";
      expect(docsTestOrigin()).toBe("https://example.test");
    } finally {
      if (before === undefined) delete process.env.DOCS_TEST_URL;
      else process.env.DOCS_TEST_URL = before;
    }
  });
});

describe("the wiring of the browser check", () => {
  test("the port is 8093 unless DOCS_TEST_PORT sets it", () => {
    expect(docsTestPort({})).toBe(8093);
  });

  test("the config: one desktop Chromium 1280x800, the local server, no reuse, no server for DOCS_TEST_URL", async () => {
    const before = process.env.DOCS_TEST_URL;
    const beforePort = process.env.DOCS_TEST_PORT;
    try {
      delete process.env.DOCS_TEST_URL;
      process.env.DOCS_TEST_PORT = "28562";
      const custom = (await import(`../e2e/playwright.config?custom=${Math.random()}`)).default;
      expect(custom.webServer.url).toBe("http://127.0.0.1:28562/email_assistant/");
      delete process.env.DOCS_TEST_PORT;
      const local = (await import(`../e2e/playwright.config?local=${Math.random()}`)).default;
      expect(local.testMatch).toBe("*.spec.ts");
      expect(local.projects).toHaveLength(1);
      expect(local.projects[0].use.viewport).toEqual({ width: 1280, height: 800 });
      expect(local.projects[0].use.browserName).toBeUndefined();
      expect(local.workers).toBe(1);
      expect(local.retries).toBe(0);
      expect(local.outputDir).toBe("test-results");
      expect(local.webServer.command).toBe("bun apps/docs/e2e/serve.ts");
      expect(local.webServer.url).toBe("http://127.0.0.1:8093/email_assistant/");
      expect(local.webServer.reuseExistingServer).toBe(false);
      process.env.DOCS_TEST_URL = "https://example.test";
      const remote = (await import(`../e2e/playwright.config?remote=${Math.random()}`)).default;
      expect(remote.webServer).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.DOCS_TEST_URL;
      else process.env.DOCS_TEST_URL = before;
      if (beforePort === undefined) delete process.env.DOCS_TEST_PORT;
      else process.env.DOCS_TEST_PORT = beforePort;
    }
  });

  test("docs:test, the pinned dev dependencies and the ignored output folders", () => {
    const root = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(root.scripts["docs:test"]).toBe("bunx playwright test -c apps/docs/e2e/playwright.config.ts");
    const docs = JSON.parse(read("apps/docs/package.json")) as { devDependencies: Record<string, string> };
    const web = JSON.parse(read("apps/web/package.json")) as { devDependencies: Record<string, string> };
    for (const name of ["@playwright/test", "@axe-core/playwright"]) {
      expect(docs.devDependencies[name]).toBe(web.devDependencies[name]);
      expect(docs.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const ignored = read(".gitignore").split("\n");
    expect(ignored).toContain("apps/docs/e2e/test-results/");
    expect(ignored).toContain("apps/docs/e2e/playwright-report/");
  });

  test("the axe tags equal the panel's", () => {
    const panel = /const WCAG_TAGS = (\[[^\]]*\]);/.exec(read("apps/web/e2e/a11y.ts"));
    expect(WCAG_TAGS).toEqual(JSON.parse(panel?.[1] ?? "[]"));
  });

  test("the spec checks T1 to T5 on the built pages and imports nothing from the panel", () => {
    const spec = read("apps/docs/e2e/site.spec.ts");
    const ids = new Set([...spec.matchAll(/test\(["`](T\d) /g)].map((match) => match[1]));
    expect([...ids].sort()).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(spec).toContain("builtPagePaths()");
    expect(spec).toContain("dist/index.html is missing");
    for (const file of ["site.spec.ts", "a11y.ts", "serve.ts", "site.ts", "playwright.config.ts"]) {
      const imports = read(`apps/docs/e2e/${file}`)
        .split("\n")
        .filter((line) => line.startsWith("import "));
      expect(imports.filter((line) => line.includes("web/e2e") || line.includes("apps/web"))).toEqual([]);
    }
  });

  test("the Starlight search button keeps no keyboard hint (axe label-content-name-mismatch)", () => {
    expect(read("apps/docs/astro.config.mjs")).toContain('customCss: ["./src/styles/custom.css"]');
    expect(read("apps/docs/src/styles/custom.css")).toMatch(/site-search kbd\s*\{\s*display: none !important;\s*\}/);
  });
});
