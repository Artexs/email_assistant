import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The pattern page (`/dev/patterns`, in the dev build: `bun run web:build:dev`). This spec knows no section: it scans the page, checks the
// width at 320 px, then opens each `[data-open-demo]` button, scans the overlay it shows and closes it. A section that adds a demo button
// is covered with no change here.
test.describe.configure({ mode: "serial" });

const BOTH = ["light", "dark"] as const;
const OVERLAY = "[role=dialog], [role=menu]";

let errors: string[] = [];

// The page is in the server HTML: a click before hydration does nothing.
async function openPage(page: Page): Promise<void> {
  await page.goto("/dev/patterns");
  await expect(page.locator("main[data-hydrated=true]")).toBeVisible();
}

test.describe("with a session", () => {
  test.beforeEach(async ({ context, page }, testInfo) => {
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 430 : 530),
    });
    errors = await cspErrors(page);
    await signInAs(page, readSeed().owner);
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test("the page has no violation in the light and the dark scheme", async ({ page }) => {
    await openPage(page);
    await expectNoA11yViolations(page, { schemes: [...BOTH] });
  });

  test("the page has no sideways scroll at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openPage(page);
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("every overlay demo opens, has no violation in either scheme and closes on Escape", async ({ page }) => {
    await openPage(page);
    const buttons = page.locator("[data-open-demo]");
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      await buttons.nth(index).click();
      const overlay = page.locator(OVERLAY).first();
      await expect(overlay).toBeVisible();
      await expectNoA11yViolations(page, { include: OVERLAY, schemes: [...BOTH] });
      await page.keyboard.press("Escape");
      await expect(page.locator(OVERLAY)).toHaveCount(0);
    }
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("no animation runs when an overlay opens", async ({ page }) => {
      await openPage(page);
      const buttons = page.locator("[data-open-demo]");
      const count = await buttons.count();
      for (let index = 0; index < count; index += 1) {
        await buttons.nth(index).click();
        await expect(page.locator(OVERLAY).first()).toBeVisible();
        expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
        await page.keyboard.press("Escape");
        await expect(page.locator(OVERLAY)).toHaveCount(0);
      }
    });
  });
});

test("a visitor with no session is sent to the login page", async ({ page }) => {
  await page.goto("/dev/patterns");
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/dev/patterns");
});
