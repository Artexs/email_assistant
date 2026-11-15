import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { E2E_APPROVALS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The approvals organization of the project (see `e2e-approvals-rows.ts`): a waiting send to Anna Nowak and a send that the owner
// approved and SEND_SCOPE=self holds (Piotr Kowalski is not on the list of the e2e server). The two tests that decide a send change it,
// so the tests of a project run in this order: the reads first, then the reject, then the approve.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().approvalsOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 203.0.113.0/24,
// a block per project, away from the 198.51.100.0/24 blocks of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 10 : 110) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const detailOf = (page: Page) => page.getByRole("region", { name: en.appr_detail_label });
const listOf = (page: Page) => page.getByRole("list", { name: en.appr_list_label });
const badgeName = (count: number) => `${en.nav_approvals} ${en.nav_approvals_badge.replace("{n}", `${count}`)}`;

test("T4: with the flag on the nav shows Approvals with the count; with it off there is no item and the page says so", async ({
  browser,
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { level: 1, name: en.title_approvals })).toBeVisible();
  // One waiting send; the held one is approved already and does not count.
  await expect(page.getByRole("link", { name: badgeName(1) })).toBeVisible();
  await expect(listOf(page).getByRole("link")).toHaveCount(2);
  expect(errors).toEqual([]);

  // The main organization has the flag off: no item, and the page shows the flag-off text. A second browser context, its own address.
  const main = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 60 : 160) + signIns}` },
    ...(project() === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  try {
    const offPage = await main.newPage();
    const offErrors = await cspErrors(offPage);
    await signInAs(offPage, readSeed().owner);
    await offPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    await offPage.goto("/approvals");
    await expect(offPage.getByText(en.appr_off)).toBeVisible();
    await expect(offPage.getByRole("link", { name: en.nav_approvals })).toHaveCount(0);
    expect(offErrors).toEqual([]);
  } finally {
    await main.close();
  }
});

test("T5: the page of a send shows the recipient, the subject, the body, the quote and the external-sender warning", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().waitingSendId}`);
  const detail = detailOf(page);
  await expect(detail.getByRole("heading", { level: 2 })).toContainText(
    `${E2E_APPROVALS.waiting.delegateName} <${E2E_APPROVALS.waiting.delegateEmail}>`
  );
  await expect(detail).toContainText(E2E_APPROVALS.waiting.subject);
  await expect(detail.getByRole("heading", { level: 3, name: en.appr_draft })).toBeVisible();
  await expect(detail).toContainText(E2E_APPROVALS.waiting.task);
  await expect(detail.getByRole("heading", { level: 3, name: en.appr_quote })).toBeVisible();
  await expect(detail).toContainText(E2E_APPROVALS.waiting.body);
  await expect(detail).toContainText(en.appr_external);
  await expect(detail).toContainText(en.appr_send_note);
  await expect(detail.getByRole("button", { name: en.appr_approve })).toBeEnabled();
  await expect(detail.getByRole("button", { name: en.appr_reject })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("T8: a member sees the list and the draft and has no Approve or Reject button", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await page.goto("/approvals");
  await expect(listOf(page).getByRole("link")).toHaveCount(2);
  await page.goto(`/approvals?id=${org().waitingSendId}`);
  await expect(detailOf(page)).toContainText(E2E_APPROVALS.waiting.body);
  await expect(detailOf(page).getByText(en.owner_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.appr_approve })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.appr_reject })).toHaveCount(0);
  // The server refuses a member as well (the page is no gate).
  const refused = await page.request.post(`/api/approvals/${org().waitingSendId}/approve`, {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  expect(refused.status()).toBe(403);
  expect(errors).toEqual([]);
});

test("T9: the list and the open draft have no axe violation", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  await page.goto("/approvals");
  await expect(listOf(page).getByRole("link")).toHaveCount(2);
  await expectNoA11yViolations(page);

  await page.goto(`/approvals?id=${org().waitingSendId}`);
  await expect(detailOf(page).getByRole("button", { name: en.appr_approve })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("T10: the phone tab bar holds 5 items and the menu holds Stats; the desktop sidebar holds all 6", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/approvals");
  const nav = page.getByRole("navigation", { name: en.nav_main });
  await expect(nav.getByRole("link", { name: en.nav_activity })).toBeVisible();
  if (project() === "mobile") {
    await expect(nav.getByRole("link")).toHaveCount(5);
    await expect(nav.getByRole("link", { name: en.nav_stats })).toHaveCount(0);
    await page.getByRole("button", { name: en.menu_open }).click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByRole("link", { name: en.nav_stats })).toBeVisible();
    await expectNoA11yViolations(page);
  } else {
    // The sidebar holds every item (the onboarding link comes with them while the owner has not finished it).
    for (const name of [
      en.nav_activity,
      en.nav_approvals,
      en.nav_mailboxes,
      en.nav_settings,
      en.nav_rules,
      en.nav_stats,
    ]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  }
});

test("T7: Reject on the held send asks for a reason; Wrong person is saved", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().heldSendId}`);
  const detail = detailOf(page);
  // The send is approved and held by the scope: it can only be rejected.
  await expect(detail).toContainText(en.appr_held_scope);
  await expect(detail.getByRole("button", { name: en.appr_approve })).toHaveCount(0);
  await detail.getByRole("button", { name: en.appr_reject }).click();
  await expect(page.getByText(en.appr_done_rejected)).toBeVisible();

  await detail.getByRole("combobox", { name: en.appr_reason_label }).click();
  await page.getByRole("option", { name: en.appr_reason_wrong_person }).click();
  await expect(page.getByText(en.appr_reason_saved)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The detail shows the new state; the rejected send is no longer in the list after a reload.
  await expect(detail).toContainText(en.appr_state_rejected);
  await page.goto("/approvals");
  await expect(listOf(page).getByRole("link")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("T6: Approve says it sends; the item leaves the list and the badge shows no number", async ({ context, page }) => {
  // The committer of the e2e server runs every 15 seconds and sends through the GreenMail of the dev stack.
  test.setTimeout(120_000);
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().waitingSendId}`);
  const detail = detailOf(page);
  await expect(page.getByRole("link", { name: badgeName(1) })).toBeVisible();
  await detail.getByRole("button", { name: en.appr_approve }).click();
  await expect(page.getByText(en.appr_done_sending)).toBeVisible();
  await expect(page.getByRole("link", { name: en.nav_approvals, exact: true })).toBeVisible();

  await expect(async () => {
    await page.reload();
    await expect(detail).toContainText(en.appr_state_sent, { timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await page.goto("/approvals");
  await expect(page.getByText(en.appr_empty)).toBeVisible();
  await expect(page.getByRole("link", { name: en.nav_approvals, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
