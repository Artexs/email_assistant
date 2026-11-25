import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Locator, Page, TestInfo } from "@playwright/test";

import { sheetDir } from "../ui-sheet/dir";

// Saves one picture of each card in the light and the dark scheme under `<sheet folder>/<folder>/`, for the owner's look at the
// contact sheet. The scheme goes back to light after it.
export async function saveCardPictures(
  page: Page,
  testInfo: TestInfo,
  folder: string,
  cards: Record<string, Locator>
): Promise<void> {
  const dir = join(sheetDir(), folder);
  mkdirSync(dir, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, card] of Object.entries(cards)) {
      await card.screenshot({
        path: join(dir, `${name}-${testInfo.project.name}-${scheme}-en.png`),
        animations: "disabled",
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
}
