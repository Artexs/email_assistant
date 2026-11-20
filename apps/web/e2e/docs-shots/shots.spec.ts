import { readFileSync } from "node:fs";

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  SHOT_DESKTOP_SIZE,
  SHOTS,
  shotFeaturesProblem,
  shotFilesProblem,
  shotTextProblem,
  type ShotEntry,
} from "../../../docs/src/shots";
import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { E2E_BASE_URL } from "../env";
import { signIn } from "../helpers";
import { shotSource } from "../lib/shot-source";
import { readSeed } from "../seed";
import { DEMO_OWNER_FILE, SHOTS_DIR } from "./shots-dir";

// ADR 0030 point 4: every screenshot of the docs site, made from the e2e seed only (synthetic data, `x.test` and
// `e2e.test` addresses). The run signs in as the owner of the seed's main organization, never as an owner of a flagged spec organization
// (approvals, delegates, stats, delete). Before the first shot it asserts that the organization has no feature flag on, so no
// shot shows a default-off feature. Before each shot it runs `publicContentProblems` on the text of the page: a problem stops the run.
test.describe.configure({ mode: "serial" });

const TEXTS = { en, pl } as const;
const TITLE_KEYS = {
  "/onboarding": "title_onboarding",
  "/mailboxes": "title_mailboxes",
  "/settings": "title_settings",
  "/rules": "title_rules",
  "/activity": "title_activity",
} as const;
const LOCALE_TAGS = { en: "en-US", pl: "pl-PL" } as const;
// The client address of the run. The Settings page lists it as "this device", so it must be a documentation address (RFC 5737), or the
// public-content check (rule R3) stops the run. The login rate limit counts per address; the run signs in once.
const CLIENT_ADDRESS = "198.51.100.200";

let owner: { email: string; password: string };
let state: Awaited<ReturnType<BrowserContext["storageState"]>>;

// The enabled feature list of the organization, as `/api/me` returns it.
async function features(page: Page): Promise<unknown> {
  const response = await page.request.get("/api/me");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { features?: unknown }).features;
}

async function shotContext(browser: Browser, shot: ShotEntry): Promise<BrowserContext> {
  const device = shot.viewport === "phone" ? devices["Pixel 7"] : { viewport: { ...SHOT_DESKTOP_SIZE } };
  const context = await browser.newContext({
    ...device,
    baseURL: E2E_BASE_URL,
    locale: LOCALE_TAGS[shot.locale],
    storageState: state,
    extraHTTPHeaders: { "x-forwarded-for": CLIENT_ADDRESS },
  });
  // The panel reads this key before it reads the browser language (`apps/web/src/i18n/index.ts`).
  await context.addInitScript((locale) => localStorage.setItem("ea.locale", locale), shot.locale);
  return context;
}

// What a reader sees: the visible text and the values of the fields that are not secret.
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
      .filter((field) => field.type !== "password")
      .map((field) => field.value);
    return [document.body.innerText, ...fields].join("\n");
  });
}

test.beforeAll(async ({ browser }) => {
  // The e2e seed's owner, or the owner of the demo organization that the setup imported.
  owner =
    shotSource().kind === "demo"
      ? (JSON.parse(readFileSync(DEMO_OWNER_FILE, "utf8")) as { owner: typeof owner }).owner
      : readSeed().owner;
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { ...SHOT_DESKTOP_SIZE },
    extraHTTPHeaders: { "x-forwarded-for": CLIENT_ADDRESS },
  });
  const page = await context.newPage();
  await signIn(page, owner.email, owner.password);
  // The e2e organization starts on the onboarding page; the demo organization has a mailbox, so it lands elsewhere.
  if (shotSource().kind === "e2e") await expect(page).toHaveURL(/\/onboarding$/);
  else await expect(page).not.toHaveURL(/\/login/);
  // The enabled list of the organization must be empty, so it holds no `docs_links` and no other flag.
  expect(shotFeaturesProblem(await features(page))).toBeNull();
  state = await context.storageState();
  await context.close();
});

for (const shot of SHOTS) {
  test(shot.name, async ({ browser }) => {
    const context = await shotContext(browser, shot);
    try {
      const page = await context.newPage();
      await page.goto(shot.path);
      // The island has settled: the heading in the page language is there, no spinner or skeleton is left.
      const title = TEXTS[shot.locale][TITLE_KEYS[shot.path as keyof typeof TITLE_KEYS]];
      await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", shot.locale);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(shotFeaturesProblem(await features(page))).toBeNull();

      // A problem stops the run, with its rule and the shot name.
      expect(shotTextProblem(await pageText(page), shot.name)).toBeNull();

      await page.screenshot({ path: `${SHOTS_DIR}/${shot.name}.png`, fullPage: false, animations: "disabled" });
    } finally {
      await context.close();
    }
  });
}

test("the run wrote exactly the files of SHOTS, each larger than 10 KB", () => {
  expect(shotFilesProblem(SHOTS_DIR)).toBeNull();
});
