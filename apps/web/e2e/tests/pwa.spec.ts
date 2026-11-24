import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The installable shell: the manifest, the service worker and the offline page. The worker caches the shell only (`/offline.html` and
// `/_astro/`): never an `/api` answer, never a page.
const onMobile = (): boolean => test.info().project.name === "mobile";
let errors: string[] = [];

// The earlier blocks use the ranges up to 90 and 190; this spec uses 85 and 185.
test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(onMobile() ? 85 : 185) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("the manifest, the worker and the offline page are public; a page still needs a session", async ({
  page,
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const body = (await manifest.json()) as { start_url: string; display: string; icons: { src: string }[] };
  expect(body.start_url).toBe("/activity");
  expect(body.display).toBe("standalone");
  for (const icon of body.icons) expect((await request.get(icon.src)).status()).toBe(200);

  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("text/javascript");
  expect(worker.headers()["cache-control"]).toBe("no-cache");

  await page.goto("/activity");
  await expect(page).toHaveURL(/\/login\?next=%2Factivity$/);

  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { level: 1, name: pl.offline_title })).toBeVisible();
  await expect(page.getByText(en.offline_text)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the manifest parses in Chromium and the page links it", async ({ page }) => {
  await page.goto("/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const manifest = await page.evaluate(
    async (url) => (await fetch(url)).json() as Promise<{ start_url: string }>,
    href ?? ""
  );
  expect(manifest.start_url).toBe("/activity");
});

test("signed in: the worker registers, takes the pages from the network and caches only the shell", async ({
  context,
  page,
}) => {
  const answers: { path: string; fromWorker: boolean }[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(page.url() || response.url()).origin) {
      answers.push({ path: url.pathname, fromWorker: response.fromServiceWorker() });
    }
  });
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/");
  // The first load is controlled once the worker has claimed the page; a reload makes it certain.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  answers.length = 0;
  await page.goto("/activity");
  await page.waitForLoadState("networkidle");

  const caches = await page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of await globalThis.caches.keys()) {
      const cache = await globalThis.caches.open(name);
      result[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
    }
    return result;
  });
  const names = Object.keys(caches);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^ea-shell-v2-[0-9a-f]{8}$/);
  const stored = caches[names[0] ?? ""] ?? [];
  expect(stored).toContain("/offline.html");
  for (const path of stored) expect(path === "/offline.html" || path.startsWith("/_astro/")).toBe(true);

  // The panel read `/api` on this load: the worker answered none of it. The page itself came through the worker (from the network).
  const api = answers.filter((answer) => answer.path.startsWith("/api/"));
  expect(api.length).toBeGreaterThan(0);
  expect(api.filter((answer) => answer.fromWorker)).toEqual([]);
  expect(answers.find((answer) => answer.path === "/activity")?.fromWorker).toBe(true);

  // No network: a page load shows the offline page; an `/api` call fails (it is not answered from a cache).
  await context.setOffline(true);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: pl.offline_title })).toBeVisible();
  const apiOffline = await page.evaluate(() =>
    fetch("/api/me").then(
      (r) => r.status,
      () => "failed"
    )
  );
  expect(apiOffline).toBe("failed");
  await context.setOffline(false);
});

// The files of the offline page come from the install, not from a run-time cache: the page loads `/login` before any worker exists, so
// the worker has seen no `/_astro/` request of it. Offline, the page still has its style sheet and its font.
test("the offline page keeps its look with no network: the worker precaches the style sheet and the font", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(onMobile() ? 86 : 186) },
  });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });

    // The server marks `/_astro/` files as immutable, so the browser's HTTP cache would answer them offline and hide a missing precache.
    const session = await context.newCDPSession(page);
    await session.send("Network.clearBrowserCache");
    await context.setOffline(true);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: pl.offline_title })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Nunito Variable"?/);
    expect(await page.evaluate(() => document.fonts.check('16px "Nunito Variable"'))).toBe(true);
    await context.setOffline(false);
  } finally {
    await context.close();
  }
});
