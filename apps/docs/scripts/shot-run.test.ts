import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHOT_DESKTOP_SIZE } from "../src/shots";

// The wiring of the shot run (step 2): `bun run docs:shots` runs `apps/web/e2e/docs-shots.config.ts`. The browser run itself needs
// the e2e stack and is made by hand under the shared lock (`flock /tmp/email-assistant-shared-tests.lock`); these tests read the files.
const ROOT = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const E2E = "apps/web/e2e";

describe("the shot run config", () => {
  const config = read(`${E2E}/docs-shots.config.ts`);
  const panel = read(`${E2E}/playwright.config.ts`);

  test("the root script runs the docs-shots config", () => {
    const root = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(root.scripts["docs:shots"]).toBe("bunx playwright test -c apps/web/e2e/docs-shots.config.ts");
  });
  test("the spec has its own folder: `test:e2e` (testDir ./tests) never runs it", () => {
    expect(config).toContain('testDir: "./docs-shots"');
    expect(panel).toContain('testDir: "./tests"');
    expect(readFileSync(join(ROOT, E2E, "docs-shots/shots.spec.ts"), "utf8")).toContain("shotFilesProblem");
    expect(read("package.json")).toContain('"test:e2e": "bunx playwright test -c apps/web/e2e/playwright.config.ts"');
  });
  test("it reuses the web servers, the env and the seed of the panel run", () => {
    expect(config).toContain("webServer: e2eWebServers(env)");
    expect(panel).toContain("webServer: e2eWebServers(env)");
    expect(config).toContain("const env = e2eEnv();");
    expect(read(`${E2E}/docs-shots/global-setup.ts`)).toMatch(
      /import globalSetup from "..\/global-setup";[\s\S]*globalSetup\(\);/
    );
    const servers = read(`${E2E}/servers.ts`);
    expect(servers).toContain("bun tools/fake-telegram/src/cli.ts serve --port ${E2E_TELEGRAM_PORT}");
    expect(servers).toContain("bun run db:migrate && bun apps/server/src/main.ts");
    // Both servers: a taken port fails the run instead of serving another build.
    expect(servers.match(/reuseExistingServer: false/g)?.length).toBe(2);
  });
  test("one test at a time, no project, the system Chromium", () => {
    expect(config).toContain("workers: 1");
    expect(config).not.toContain("projects:");
    expect(config).toContain("launchOptions: e2eLaunchOptions()");
    expect(read(`${E2E}/servers.ts`)).toContain("const chromiumPath = process.env.CHROMIUM_PATH;");
  });
  test("the global setup empties the shot folder before it seeds, and the folder is apps/docs/public/shots", () => {
    const setup = read(`${E2E}/docs-shots/global-setup.ts`);
    expect(setup).toContain('file.endsWith(".png")');
    expect(setup.indexOf("rmSync")).toBeGreaterThan(-1);
    expect(setup.indexOf("rmSync")).toBeLessThan(setup.indexOf("globalSetup();"));
    expect(read(`${E2E}/docs-shots/shots-dir.ts`)).toContain('resolve(repoRoot, "apps/docs/public/shots")');
  });
});

describe("the shot spec", () => {
  const spec = read(`${E2E}/docs-shots/shots.spec.ts`);
  const at = (text: string) => {
    const index = spec.indexOf(text);
    expect(index).toBeGreaterThan(-1);
    return index;
  };

  test("it signs in as the owner of the seed's main organization, never as a flagged spec owner", () => {
    expect(spec).toContain("owner = readSeed().owner;");
    expect(spec).toContain("signIn(page, owner.email, owner.password)");
    for (const other of [
      "twoFactorOwners",
      "otherOrg",
      "activityMembers",
      "approvals",
      "delegates",
      "stats",
      "delete",
    ]) {
      expect(spec).not.toContain(`readSeed().${other}`);
    }
  });
  test("before the first shot it asserts that no feature flag is on (plan P2)", () => {
    const setup = at("test.beforeAll(");
    const check = at("shotFeaturesProblem(await features(page))");
    expect(check).toBeGreaterThan(setup);
    expect(check).toBeLessThan(at("for (const shot of SHOTS)"));
    expect(spec).toContain('page.request.get("/api/me")');
  });
  test("each shot checks the page text before it takes the screenshot", () => {
    expect(at("shotTextProblem(await pageText(page), shot.name)")).toBeLessThan(at("page.screenshot("));
  });
  test("the island has settled before the shot: heading, language, no spinner", () => {
    const settled = at("toHaveCount(0)");
    expect(spec).toContain('[aria-busy="true"]');
    expect(settled).toBeLessThan(at("page.screenshot("));
    expect(at('getByRole("heading"')).toBeLessThan(settled);
    expect(spec).toContain('toHaveAttribute("lang", shot.locale)');
  });
  test("viewports: desktop 1280x800, the Pixel 7 device on a phone; not full page", () => {
    expect(SHOT_DESKTOP_SIZE).toEqual({ width: 1280, height: 800 });
    expect(spec).toContain('shot.viewport === "phone" ? devices["Pixel 7"] : { viewport: { ...SHOT_DESKTOP_SIZE } }');
    expect(spec).toContain("fullPage: false");
  });
  test("the language comes from the storage key of the panel", () => {
    expect(spec).toContain('localStorage.setItem("ea.locale", locale)');
  });
  test("the client address is a documentation address (RFC 5737), because the Settings page shows it", () => {
    expect(spec).toContain('const CLIENT_ADDRESS = "198.51.100.200";');
  });
  test("it writes to the shot folder, and the last test checks the files", () => {
    expect(spec).toContain("path: `${SHOTS_DIR}/${shot.name}.png`");
    expect(at("shotFilesProblem(SHOTS_DIR)")).toBeGreaterThan(at("page.screenshot("));
  });
});
