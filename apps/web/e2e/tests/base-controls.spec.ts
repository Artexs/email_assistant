import { expect, test, type Locator, type Page } from "@playwright/test";

import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The sizes and the look of the base controls (buttons, cards, fields, switches), read as computed styles from the pattern page
// (`/dev/patterns`, in the dev build). The generic spec `patterns.spec.ts` scans the same page for violations.
test.describe.configure({ mode: "serial" });

let errors: string[] = [];

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return Math.round(box.height);
}

async function box(locator: Locator): Promise<{ width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("the element has no box");
  return { width: Math.round(found.width), height: Math.round(found.height) };
}

async function style(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

// The value a class gives to a plain element: the expected colour of a token class, as the browser computes it.
async function classValue(page: Page, className: string, property: string): Promise<string> {
  return page.evaluate(
    ([name, prop]) => {
      const probe = document.createElement("span");
      probe.className = name;
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return value;
    },
    [className, property] as const
  );
}

async function openPage(page: Page): Promise<void> {
  await page.goto("/dev/patterns");
  await expect(page.locator("main[data-hydrated=true]")).toBeVisible();
}

test.beforeEach(async ({ context, page }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 440 : 540),
  });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  await openPage(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const BUTTON_HEIGHTS = [
  ["lg", 52],
  ["default", 48],
  ["sm", 44],
  ["xs", 36],
] as const;

test.describe("buttons", () => {
  for (const variant of ["default", "soft", "secondary", "outline", "ghost", "destructive", "destructive-soft"]) {
    for (const [size, expected] of BUTTON_HEIGHTS) {
      test(`the ${variant} button of size ${size} is ${expected} px high`, async ({ page }) => {
        const button = page.getByRole("button", { name: `${variant} ${size}`, exact: true });
        expect(await height(button)).toBe(expected);
      });
    }
  }

  test("the icon buttons have the heights of the text buttons", async ({ page }) => {
    for (const [size, expected] of [
      ["icon", 48],
      ["icon-sm", 44],
    ] as const) {
      expect(await box(page.getByRole("button", { name: `Add ${size}`, exact: true }))).toEqual({
        width: expected,
        height: expected,
      });
    }
  });

  test("the primary button has the soft coloured shadow and the outline button has no shadow", async ({ page }) => {
    const primary = page.getByRole("button", { name: "default default", exact: true });
    const outline = page.getByRole("button", { name: "outline default", exact: true });
    expect(await style(primary, "box-shadow")).not.toBe("none");
    expect(await style(outline, "box-shadow")).toBe("none");
  });

  test("a button is a full pill with bold text", async ({ page }) => {
    const button = page.getByRole("button", { name: "default default", exact: true });
    expect(Number.parseFloat(await style(button, "border-top-left-radius"))).toBeGreaterThanOrEqual(1000);
    expect(await style(button, "font-weight")).toBe("700");
  });

  test("a focused button has a 3 px outline in the ring colour with a 2 px gap", async ({ page }) => {
    const button = page.getByRole("button", { name: "outline default", exact: true });
    // The keyboard comes first, so the browser treats the focus as keyboard focus (`:focus-visible`).
    await page.keyboard.press("Tab");
    await button.focus();
    await expect(button).toBeFocused();
    // `transition-all` animates the outline in: poll until it has settled.
    await expect.poll(() => style(button, "outline-width")).toBe("3px");
    await expect.poll(() => style(button, "outline-offset")).toBe("2px");
    const ring = await classValue(page, "outline-ring outline-1", "outline-color");
    await expect.poll(() => style(button, "outline-color")).toBe(ring);
  });
});

test.describe("fields", () => {
  test("a default input is 48 px high with 16 px text and a 2 px edge in the input colour", async ({ page }) => {
    const input = page.getByLabel("Default input", { exact: true });
    expect(await height(input)).toBe(48);
    expect(await style(input, "font-size")).toBe("16px");
    expect(await style(input, "border-top-width")).toBe("2px");
    expect(await style(input, "border-top-color")).toBe(
      await classValue(page, "border-2 border-input", "border-top-color")
    );
  });

  test("an input with the compact class is 36 px high", async ({ page }) => {
    expect(await height(page.getByLabel("Compact input", { exact: true }))).toBe(36);
  });

  test("a textarea is at least 96 px high with 16 px text", async ({ page }) => {
    const textarea = page.getByLabel("Default textarea", { exact: true });
    expect(await height(textarea)).toBeGreaterThanOrEqual(96);
    expect(await style(textarea, "font-size")).toBe("16px");
  });

  test("a select trigger is 48 px high and its sm size is 36 px", async ({ page }) => {
    expect(await height(page.getByRole("combobox", { name: "Default select", exact: true }))).toBe(48);
    expect(await height(page.getByRole("combobox", { name: "Compact select", exact: true }))).toBe(36);
  });

  test("an invalid input has the destructive edge", async ({ page }) => {
    const invalid = page.getByLabel("Invalid input", { exact: true });
    const valid = page.getByLabel("Default input", { exact: true });
    expect(await style(invalid, "border-top-color")).not.toBe(await style(valid, "border-top-color"));
  });

  test("a switch is 52 by 30 px and its track changes colour when it is on", async ({ page }) => {
    const off = page.getByRole("switch", { name: "Switch off", exact: true });
    const on = page.getByRole("switch", { name: "Switch on", exact: true });
    expect(await box(off)).toEqual({ width: 52, height: 30 });
    expect(await style(off, "background-color")).not.toBe(await style(on, "background-color"));
  });
});

test.describe("cards", () => {
  test("a card has no border and a shadow", async ({ page }) => {
    const card = page.locator("[data-demo=card]");
    expect(await style(card, "border-top-width")).toBe("0px");
    expect(await style(card, "box-shadow")).not.toBe("none");
  });

  test("a card has a border in forced-colors mode", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    expect(await style(page.locator("[data-demo=card]"), "border-top-width")).toBe("1px");
  });
});
