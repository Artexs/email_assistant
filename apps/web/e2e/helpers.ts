import type { Page } from "@playwright/test";

import { en } from "../src/i18n/en";

// An address range for documentation (RFC 5737). Every test gets its own, so the login rate limit counts per test.
// Playwright runs each project in its own worker process, where the counter starts at 1 again: the caller gives each a block.
let addressCount = 0;

export function nextAddress(base: number): string {
  addressCount += 1;
  return `198.51.100.${base + addressCount}`;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  // The form is in the server HTML, so a click before hydration would post it natively. The island's first effect asks for the session.
  const hydrated = page.waitForResponse((response) => response.url().includes("/api/auth/get-session"));
  await page.goto("/login");
  await hydrated;
  await page.getByLabel(en.email_label).fill(email);
  await page.getByLabel(en.password_label, { exact: true }).fill(password);
  await page.getByRole("button", { name: en.sign_in }).click();
}

const violationPrefix = "csp-violation";

// Fact 23: Chromium reports an eval violation only as a `securitypolicyviolation` event, without console text. The page logs it.
export async function cspErrors(page: Page): Promise<string[]> {
  const collected: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") || text.startsWith(violationPrefix)) collected.push(text);
  });
  page.on("pageerror", (error) => {
    collected.push(`pageerror ${error.message}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      // eslint-disable-next-line no-console -- the helper collects this line from the console
      console.warn(`csp-violation ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return collected;
}
