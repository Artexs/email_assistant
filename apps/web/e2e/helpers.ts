import { expect, type Page } from "@playwright/test";

import { en } from "../src/i18n/en";
import { E2E_BASE_URL, GREENMAIL } from "./env";

// An address range for documentation (RFC 5737). Every test gets its own, so the login rate limit counts per test.
// The counter lives in the worker process and all spec files of that worker share it, so two files can use the same block.
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

export async function signInAs(page: Page, user: { email: string; password: string }): Promise<void> {
  await signIn(page, user.email, user.password);
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

// Console errors of the page (a failed request logs one too: the caller clears the list with `.length = 0` before the part it checks).
export function consoleErrors(page: Page): string[] {
  const collected: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") collected.push(message.text());
  });
  return collected;
}

// The address of the mailbox a spec connects: one per project, so the two never meet.
export function mailboxAddress(project: string): string {
  return `e2e-${project}@e2e.test`;
}

// Removes what a spec made, through the API with the page's cookies: unlink, every mailbox, every rule, then the organization and digest settings. Errors are ignored:
// a cleanup must not hide the real failure. The Origin header is the CSRF check of the API.
export async function cleanUpOrg(page: Page): Promise<void> {
  const headers = { origin: E2E_BASE_URL };
  try {
    await page.request.delete("/api/channels/telegram/link", { headers });
    const list = await page.request.get("/api/mailboxes");
    if (list.ok()) {
      const mailboxes = (await list.json()) as { id: string; address: string }[];
      for (const mailbox of mailboxes) {
        await page.request.delete(`/api/mailboxes/${mailbox.id}`, {
          headers,
          data: { confirmAddress: mailbox.address },
        });
      }
    }
    const rules = await page.request.get("/api/rules");
    if (rules.ok()) {
      for (const rule of (await rules.json()) as { id: string }[]) {
        await page.request.delete(`/api/rules/${rule.id}`, { headers });
      }
    }
    await page.request.patch("/api/organization", { headers, data: { timezone: "Europe/Warsaw", styleText: null } });
    await page.request.patch("/api/me/digest-times", { headers, data: { times: [] } });
  } catch {
    // Ignored on purpose.
  }
}

// Fills the open connect dialog for the GreenMail of the dev stack (provider "Other") and submits it.
export async function connectGreenMail(page: Page, project: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: en.provider_label }).click();
  await page.getByRole("option", { name: en.preset_other }).click();
  await dialog.getByLabel(en.address_label).fill(mailboxAddress(project));
  await dialog.getByLabel(en.mb_password_label, { exact: true }).fill("e2e-mailbox-password");
  await dialog.getByLabel(en.imap_host_label).fill(GREENMAIL.host);
  await dialog.getByLabel(en.imap_port_label).fill(`${GREENMAIL.imapPort}`);
  await dialog.getByLabel(en.smtp_host_label).fill(GREENMAIL.host);
  await dialog.getByLabel(en.smtp_port_label).fill(`${GREENMAIL.smtpPort}`);
  await dialog.getByRole("button", { name: en.connect_submit }).click();
  await expect(page.getByText(en.connected_toast)).toBeVisible();
}
