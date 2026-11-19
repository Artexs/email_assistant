import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_SUGGESTIONS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The suggestions organization of the project (see `e2e-seed.ts`): the flags `sender_context` and `sender_suggestions` are on; one
// mailbox with three open suggestions (`E2E_SUGGESTIONS`): a VIP address, a blocklist address and a whitelist domain. The tests run
// in order, one after the other: the first accepts the VIP row, the second dismisses the blocklist row, the third looks at what is left.
const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().suggestionOrgs[project()];
const S = E2E_SUGGESTIONS;

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
const row = (page: Page, pattern: string): Locator => card(page).locator(`li[data-pattern="${pattern}"]`);

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
  await expect(card(page).locator("li[data-pattern]")).toHaveCount(3);
  // The newest first.
  await expect(card(page).locator("li[data-pattern]").first()).toHaveAttribute("data-pattern", S.vip.pattern);
  await expect(row(page, S.vip.pattern)).toContainText("You answered 6 of 8 mails in 30 days.");
  await expect(row(page, S.vip.pattern)).toContainText(en.rule_kind_vip);
  await expect(row(page, S.blocklist.pattern)).toContainText(
    "You marked 3 mails as spam in 90 days and never wrote to this sender."
  );
  await expect(row(page, S.whitelist.pattern)).toContainText("from 2 senders of this domain");
  await expect(page.locator("[data-kind=vip]").filter({ hasText: S.vip.pattern })).toHaveCount(0);

  await row(page, S.vip.pattern)
    .getByRole("button", { name: `Accept the suggestion for ${S.vip.pattern}` })
    .click();
  await expect(page.getByText(en.rule_added_toast)).toBeVisible();
  await expect(row(page, S.vip.pattern)).toHaveCount(0);
  await expect(card(page).locator("li[data-pattern]")).toHaveCount(2);
  // The rule list loads again: the VIP card holds the new rule.
  await expect(page.locator("[data-kind=vip]").filter({ hasText: S.vip.pattern })).toBeVisible();
  expect(errors).toEqual([]);
});

test("T2: Dismiss hides the blocklist row; it stays gone after a reload and no rule is made", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(card(page).locator("li[data-pattern]")).toHaveCount(2);
  await row(page, S.blocklist.pattern)
    .getByRole("button", { name: `Dismiss the suggestion for ${S.blocklist.pattern}` })
    .click();
  await expect(page.getByText(en.sg_dismissed_toast)).toBeVisible();
  await expect(row(page, S.blocklist.pattern)).toHaveCount(0);
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(row(page, S.blocklist.pattern)).toHaveCount(0);
  await expect(card(page).locator("li[data-pattern]")).toHaveCount(1);
  await expect(page.locator("[data-kind=blocklist]").filter({ hasText: S.blocklist.pattern })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T3: a member sees the row that is left, the note, and no button; the page sends no write", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().member);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suggestions") && request.method() !== "GET") {
      writes.push(request.method());
    }
  });
  await openCard(page);
  await expect(card(page).locator("li[data-pattern]")).toHaveCount(1);
  await expect(row(page, S.whitelist.pattern)).toContainText(en.rule_kind_whitelist);
  await expect(card(page)).toContainText(en.sg_member_note);
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("T4: the card passes the accessibility check for the owner", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(row(page, S.whitelist.pattern)).toBeVisible();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T5: with the flag off the Rules page has no suggestions card and the page asks once, then no more", async ({
  context,
  page,
}) => {
  // The paused organization: one mailbox and no flag `sender_suggestions`.
  const errors = await startSession(context, page, readSeed().pausedOwner);
  const lists: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suggestions/")) lists.push(request.url());
  });
  await page.goto("/rules");
  await expect(page.locator("[data-kind=vip]")).toBeVisible();
  await expect.poll(() => lists.length).toBe(1);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(en.sg_title, { exact: true })).toHaveCount(0);
  expect(lists).toHaveLength(1);
  expect(errors).toEqual([]);
});
