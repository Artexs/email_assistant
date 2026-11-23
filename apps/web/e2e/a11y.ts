import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { defaultSchemes, type ColorScheme } from "./lib/schemes";

// WCAG 2.0 to 2.2, levels A and AA. No rule is turned off for a whole page.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface A11yScope {
  // A CSS selector: only this part of the page is checked (for example an open dialog).
  include?: string;
  // CSS selectors left out. Every use needs a code comment that names the reason.
  exclude?: string[];
  // The colour schemes to scan, in this order. Without it: `defaultSchemes` of the running project.
  schemes?: ColorScheme[];
}

// Checks the page as it is now, once for each scheme. A scheme is emulated, scanned, and at the end the scheme the page had comes back.
// Call it after the page has loaded its data. A violation fails with one line each: the scheme, rule id, impact, the first target
// selector and the help URL. The message holds no page text (no mail text in test output).
export async function expectNoA11yViolations(page: Page, scope: A11yScope = {}): Promise<void> {
  const schemes = scope.schemes ?? defaultSchemes(test.info().project.name);
  const before: ColorScheme = (await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
    ? "dark"
    : "light";
  const lines: string[] = [];
  try {
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      lines.push(...(await scan(page, scope)).map((line) => `${scheme} ${line}`));
    }
  } finally {
    await page.emulateMedia({ colorScheme: before });
  }
  expect(lines, "axe violations").toEqual([]);
}

async function scan(page: Page, scope: A11yScope): Promise<string[]> {
  // A dialog fades in: axe reads the half-faded colours as low contrast. Wait until no animation runs.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (scope.include !== undefined) builder = builder.include(scope.include);
  for (const selector of scope.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unknown"}) ${violation.nodes.length}x first ${String(violation.nodes[0]?.target[0] ?? "-")} ${violation.helpUrl}`
  );
}
