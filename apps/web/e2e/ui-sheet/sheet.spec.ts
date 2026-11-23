import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { E2E_BASE_URL } from "../env";
import { signIn } from "../helpers";
import { sheetIndexHtml, type SheetEntry } from "../lib/sheet-index";
import { readSeed } from "../seed";
import { sheetDir, sheetRouteFilter } from "./dir";
import { SHEET_ROUTES, SHEET_STATES, resolveSheetPath, type SheetRoute, type SheetState } from "./routes";
import { sheetIds, sheetUser } from "./states";

// The contact sheet. A run records pictures; it never compares them. It fails only when a page does not load.
test.describe.configure({ mode: "serial" });

const TEXTS = { en, pl } as const;
const LOCALES = ["en", "pl"] as const;
const SCHEMES = ["light", "dark"] as const;
const VIEWPORTS = ["phone", "desktop"] as const;
const LOCALE_TAGS = { en: "en-US", pl: "pl-PL" } as const;
const DESKTOP_SIZE = { width: 1280, height: 800 } as const;
const NARROW_SIZE = { width: 320, height: 640 } as const;

const dir = sheetDir();
const filter = sheetRouteFilter();
const routes = SHEET_ROUTES.filter((route) => filter === null || filter.includes(route.name));

// A documentation address (RFC 5737) for each state, so the login rate limit (per address) holds. One sign-in for each state.
function clientAddress(state: SheetState): string {
  return `198.51.100.${100 + SHEET_STATES.indexOf(state)}`;
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<SheetState, StorageState | null>();

async function newContext(
  browser: Browser,
  route: SheetRoute,
  options: {
    viewport: (typeof VIEWPORTS)[number] | "narrow";
    scheme: (typeof SCHEMES)[number];
    locale: (typeof LOCALES)[number];
  }
): Promise<BrowserContext> {
  const device =
    options.viewport === "phone"
      ? devices["Pixel 7"]
      : { viewport: { ...(options.viewport === "narrow" ? NARROW_SIZE : DESKTOP_SIZE) } };
  const context = await browser.newContext({
    ...device,
    baseURL: E2E_BASE_URL,
    locale: LOCALE_TAGS[options.locale],
    colorScheme: options.scheme,
    storageState: sessions.get(route.state) ?? undefined,
    extraHTTPHeaders: { "x-forwarded-for": clientAddress(route.state) },
  });
  // The panel reads this key before it reads the browser language (`apps/web/src/i18n/index.ts`).
  await context.addInitScript((locale) => localStorage.setItem("ea.locale", locale), options.locale);
  return context;
}

// Opens the page and waits until it has settled. A page that does not load (an error status, no heading) fails the run.
async function openRoute(page: Page, route: SheetRoute, locale: (typeof LOCALES)[number]): Promise<void> {
  const path = resolveSheetPath(route.path, sheetIds(readSeed(), route.state));
  const response = await page.goto(path);
  expect(response?.status(), `${route.name} status`).toBeLessThan(400);
  if (route.ready !== null) {
    await expect(page.getByRole("heading", { name: TEXTS[locale][route.ready], exact: true }).first()).toBeVisible();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  if (route.open !== null) {
    await page.getByRole("button", { name: TEXTS[locale][route.open], exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await page.waitForLoadState("networkidle");
}

test.beforeAll(async ({ browser }) => {
  const seed = readSeed();
  for (const state of new Set(routes.map((route) => route.state))) {
    if (state === "public") {
      sessions.set(state, null);
      continue;
    }
    const user = sheetUser(seed, state);
    const context = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { ...DESKTOP_SIZE },
      extraHTTPHeaders: { "x-forwarded-for": clientAddress(state) },
    });
    const page = await context.newPage();
    await signIn(page, user.email, user.password);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    sessions.set(state, await context.storageState());
    await context.close();
  }
});

for (const route of routes) {
  test(route.name, async ({ browser }) => {
    const folder = join(dir, route.state);
    mkdirSync(folder, { recursive: true });
    const entries: SheetEntry[] = [];
    for (const locale of LOCALES) {
      for (const scheme of SCHEMES) {
        for (const viewport of VIEWPORTS) {
          const context = await newContext(browser, route, { viewport, scheme, locale });
          try {
            const page = await context.newPage();
            await openRoute(page, route, locale);
            const file = `${route.state}/${route.name}-${viewport}-${scheme}-${locale}.png`;
            await page.screenshot({ path: join(dir, file), fullPage: true, animations: "disabled" });
            entries.push({ state: route.state, name: route.name, viewport, scheme, locale, file, overflow: false });
          } finally {
            await context.close();
          }
        }
      }
    }
    // Sideways scroll at 320 px: recorded on every picture of the route.
    const narrow = await newContext(browser, route, { viewport: "narrow", scheme: "light", locale: "en" });
    let overflow = false;
    try {
      const page = await narrow.newPage();
      await openRoute(page, route, "en");
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    } finally {
      await narrow.close();
    }
    writeFileSync(join(folder, `${route.name}.json`), JSON.stringify(entries.map((entry) => ({ ...entry, overflow }))));
  });
}

test("the index lists every picture of the folder", () => {
  const entries: SheetEntry[] = [];
  for (const route of SHEET_ROUTES) {
    try {
      entries.push(...(JSON.parse(readFileSync(join(dir, route.state, `${route.name}.json`), "utf8")) as SheetEntry[]));
    } catch {
      // A route that no run wrote has no pictures.
    }
  }
  expect(entries.length, "pictures").toBeGreaterThan(0);
  writeFileSync(join(dir, "index.html"), sheetIndexHtml(entries));
});
