import { execFileSync } from "node:child_process";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_SUGGESTIONS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv, repoRoot } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The suggestions organization of the project (see `e2e-seed.ts`): the flags `sender_context`, `sender_suggestions` and `sent_sync`
// are on; one mailbox with three open suggestions (`E2E_SUGGESTIONS`): a VIP address, a blocklist address and a whitelist domain.
// Each test resets them first (`e2e-suggestions.ts`: the three rows, no sender rule, fresh Sent coverage), so no test depends on
// another and the hourly profile pass cannot have withdrawn a row since the seed.
const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().suggestionOrgs[project()];
const S = E2E_SUGGESTIONS;

test.beforeEach(() => {
  execFileSync("bun", ["apps/server/src/scripts/e2e-suggestions.ts", "--mailbox-id", org().mailbox.id], {
    cwd: repoRoot,
    env: e2eEnv(),
    stdio: "pipe",
    timeout: 30_000,
  });
});

// Every test signs in once, from its own client address (the login rate limit counts per address). Documentation range 192.0.2.0/24.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 60 : 190) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const card = (page: Page) => page.locator("[data-card=suggestions]");
const row = (page: Page, pattern: string): Locator => card(page).locator(`[data-pattern="${pattern}"]`);

async function openCard(page: Page): Promise<void> {
  await page.goto("/rules");
  await expect(card(page)).toBeVisible();
}

test("T1: the owner sees the rows with the kind and the reason, accepts the VIP row, and the rule list shows the rule", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(3);
  // The newest first.
  await expect(card(page).locator("[data-pattern]").first()).toHaveAttribute("data-pattern", S.vip.pattern);
  await expect(row(page, S.vip.pattern)).toContainText("You answered 6 of 8 mails in 30 days.");
  await expect(row(page, S.vip.pattern)).toContainText(en.rule_kind_vip);
  await expect(row(page, S.blocklist.pattern)).toContainText(
    "You marked 3 mails as spam in 90 days and did not write to this sender in that time."
  );
  await expect(row(page, S.whitelist.pattern)).toContainText("from 2 senders of this domain");
  await expect(page.locator("[data-kind=vip]").filter({ hasText: S.vip.pattern })).toHaveCount(0);

  // A half-typed rule in the add form stays when a suggestion is accepted.
  const typed = "half-typed@example.test";
  await page.getByLabel(en.rules_pattern_label).fill(typed);
  await row(page, S.vip.pattern)
    .getByRole("button", { name: `Accept the suggestion for ${S.vip.pattern}` })
    .click();
  await expect(page.getByText(en.rule_added_toast)).toBeVisible();
  await expect(row(page, S.vip.pattern)).toHaveCount(0);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(2);
  // The rule list loads again: the VIP card holds the new rule.
  await expect(page.locator("[data-kind=vip]").filter({ hasText: S.vip.pattern })).toBeVisible();
  await expect(page.getByLabel(en.rules_pattern_label)).toHaveValue(typed);
  // The focus moves to the card, not to the page.
  await expect(card(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test("T2: Dismiss hides the blocklist row; it stays gone after a reload and no rule is made", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(3);
  await row(page, S.blocklist.pattern)
    .getByRole("button", { name: `Dismiss the suggestion for ${S.blocklist.pattern}` })
    .click();
  await expect(page.getByText(en.sg_dismissed_toast)).toBeVisible();
  await expect(row(page, S.blocklist.pattern)).toHaveCount(0);
  await expect(card(page)).toBeFocused();
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(row(page, S.blocklist.pattern)).toHaveCount(0);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(2);
  await expect(page.locator("[data-kind=blocklist]").filter({ hasText: S.blocklist.pattern })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T3: a member sees all rows, the note, and no button; the page sends no write", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suggestions") && request.method() !== "GET") {
      writes.push(request.method());
    }
  });
  await openCard(page);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(3);
  await expect(row(page, S.whitelist.pattern)).toContainText(en.rule_kind_whitelist);
  await expect(card(page)).toContainText(en.sg_member_note);
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("T4: the card passes the accessibility check for the owner", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(card(page).locator("[data-pattern]")).toHaveCount(3);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T7: on a phone the Rules page with both cards has no sideways scroll", async ({ context, page }) => {
  test.skip(project() !== "mobile", "the phone project only");
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(page.locator("[data-card=newsletters]")).toBeVisible();
  await expect(card(page).locator("[data-pattern]")).toHaveCount(3);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  expect(errors).toEqual([]);
});

test("T5: with the flag off the Rules page has no suggestions card, asks once, and asks no more when time passes", async ({
  context,
  page,
}) => {
  // The paused organization: one mailbox and no flag `sender_suggestions`.
  const errors = await startSession(context, page, readSeed().pausedOwner);
  const lists: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suggestions/")) lists.push(request.url());
  });
  // A fake clock: three poll periods (30 s each) pass at once, so a loader that polls on would send more requests.
  await page.clock.install();
  await page.goto("/rules");
  await expect(page.locator("[data-kind=vip]")).toBeVisible();
  await expect.poll(() => lists.length).toBe(1);
  await expect(card(page)).toHaveCount(0);
  await page.clock.runFor(95_000);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(en.sg_title, { exact: true })).toHaveCount(0);
  expect(lists).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("T6: while the card shows, time passes and the list loads again (the poll runs, so T5 means something)", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const lists: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suggestions/")) lists.push(request.url());
  });
  await page.clock.install();
  await page.goto("/rules");
  await expect(card(page)).toBeVisible();
  await expect.poll(() => lists.length).toBe(1);
  await page.clock.runFor(65_000);
  await expect.poll(() => lists.length).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
