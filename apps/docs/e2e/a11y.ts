import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// WCAG 2.0 to 2.2, levels A and AA: the same tags as the panel (`apps/web/e2e/a11y.ts`, F102 D13). No rule is turned off.
// A docs-local copy: the docs app imports nothing from `apps/web/e2e`.
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// One line per violated rule: id, impact, count, the first target and the help URL. No page text.
export async function a11yLines(page: Page): Promise<string[]> {
  // Wait until no animation runs: axe reads half-faded colours as low contrast.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unknown"}) ${violation.nodes.length}x first ${String(violation.nodes[0]?.target[0] ?? "-")} ${violation.helpUrl}`
  );
}

export async function expectNoA11yViolations(page: Page): Promise<void> {
  expect(await a11yLines(page), "axe violations").toEqual([]);
}
