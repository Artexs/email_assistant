import { execFileSync } from "node:child_process";

import { expect, type Locator, type Page } from "@playwright/test";

import { en } from "../src/i18n/en";
import { mailTagFromEnv, taggedAddress } from "../../server/src/scripts/e2e-seed-args";
import { E2E_BASE_URL, e2eEnv, GREENMAIL, repoRoot } from "./env";

// Every test gets its own client address, so the login rate limit (3 per 10 s per address) counts per test.
// The counter lives in the worker process and all spec files of that worker share it, so two files can use the same block.
// Playwright runs each project in its own worker process, where the counter starts at 1 again: the caller gives each a block.
// The sum `base + counter` is the host number inside the range 198.18.0.0/15 (RFC 2544, benchmark testing): a sum above 255
// moves to the next third octet. A fourth octet above 255 (the old `198.51.100.${base + counter}`, a longer run made it reach 256
// in the desktop project) is no address: the server then keys the limit on the proxy address 127.0.0.1, and every later test
// of the project shares one bucket. The specs with a literal address use 198.51.100.0/24 and 203.0.113.0/24, away from this range.
let addressCount = 0;

export function nextAddress(base: number): string {
  addressCount += 1;
  const host = base + addressCount;
  return `198.18.${Math.floor(host / 256)}.${host % 256}`;
}

interface SignInTexts {
  email_label: string;
  password_label: string;
  sign_in: string;
}

export async function signIn(page: Page, email: string, password: string, texts: SignInTexts = en): Promise<void> {
  // The form is in the server HTML, so a click before hydration would post it natively. The island's first effect asks for the session.
  const hydrated = page.waitForResponse((response) => response.url().includes("/api/auth/get-session"));
  await page.goto("/login");
  await hydrated;
  await page.getByLabel(texts.email_label).fill(email);
  await page.getByLabel(texts.password_label, { exact: true }).fill(password);
  await page.getByRole("button", { name: texts.sign_in }).click();
}

export async function signInAs(
  page: Page,
  user: { email: string; password: string },
  texts: SignInTexts = en
): Promise<void> {
  await signIn(page, user.email, user.password, texts);
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

// The address of the mailbox a spec connects: one per project, so the two never meet. The run tag (`E2E_MAIL_TAG`) keeps two runs
// on the shared GreenMail apart; the seed reads the same variable.
export function mailboxAddress(project: string): string {
  return taggedAddress(`e2e-${project}@e2e.test`, mailTagFromEnv(process.env));
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
    await page.request.patch("/api/organization", { headers, data: { timezone: "Europe/Warsaw" } });
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

// Fills the connected mailbox with the activity rows. Runs the server script with the e2e env;
// `execFileSync` throws with the script's stderr on a non-zero exit.
export function seedActivity(mailboxId: string): void {
  execFileSync("bun", ["apps/server/src/scripts/e2e-activity.ts", "--mailbox-id", mailboxId], {
    cwd: repoRoot,
    env: e2eEnv(),
    stdio: "pipe",
    timeout: 30_000,
  });
}

export interface AlertFill {
  boxWidth: number;
  textWidth: number;
  lines: number;
}

// The layout of the text inside one alert: the width of the box, the width of the widest text line, and the number of lines.
// A text node has no element of its own, so the helper measures it with a DOM range. An alert that collapses its bare text
// into a zero-width column shows as many lines as words and a narrow text.
export async function alertFill(alert: Locator): Promise<AlertFill> {
  return alert.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = element.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    // Text lines of an element child (a paragraph) and of a bare text child both land in the range rectangles.
    const tops = new Set(rects.map((rect) => Math.round(rect.top)));
    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));
    return { boxWidth: box.width, textWidth: right - left, lines: tops.size };
  });
}

// The text of an alert fills its box: at least half as wide, or the whole text fits on one line.
export function expectAlertFills(fill: AlertFill, name: string): void {
  const filled = fill.textWidth >= fill.boxWidth / 2 || fill.lines === 1;
  expect(
    filled,
    `${name}: text ${Math.round(fill.textWidth)}px in a box of ${Math.round(fill.boxWidth)}px on ${fill.lines} lines`
  ).toBe(true);
}
