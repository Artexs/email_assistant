import { expect, test } from "@playwright/test";

import { DOCS_BASE, PRODUCT_NAME } from "@ea/core";

import { distIsBuilt, docsTestOrigin } from "./site";

// The brand mark of the docs site: the header logo and the favicon. The built site must exist first: `bun run docs:build`.
if (!distIsBuilt()) {
  throw new Error("apps/docs/dist/index.html is missing: run `bun run docs:build` before `bun run docs:test`");
}

const ORIGIN = docsTestOrigin();

test("the home page shows the mark next to the product name", async ({ page, request }) => {
  await page.goto(`${ORIGIN}${DOCS_BASE}/`, { waitUntil: "load" });

  const title = page.locator(".site-title");
  const logo = title.locator("img");
  await expect(logo).toHaveAttribute("alt", "");
  expect(await logo.getAttribute("src")).toMatch(/\.svg(\?.*)?$/);
  await expect(title).toContainText(PRODUCT_NAME);

  const href = await page.locator('link[rel~="icon"]').first().getAttribute("href");
  expect(href).toBe(`${DOCS_BASE}/favicon.svg`);
  const icon = await request.get(new URL(href ?? "", ORIGIN).toString());
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
});
