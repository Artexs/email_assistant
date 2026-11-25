import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The panel review "Was I right?". It runs on the review organization of the project (see `e2e-seed.ts`): the flags
// `panel_review` and `trust_ladder` are on; one mailbox with a done history check and 12 real mails with a triage result and no label
// (`e2e-review-rows.ts`). The tests of a project run in this order and label mail, so each one reads the state the one before left:
// 12 mails, then 2, 3, 4 and 12 labels (RV2 to RV5), then none left (RV6).
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().reviewOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 192.0.2.0/24, a block
// per project, away from the blocks of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 75 : 180) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const reviewPath = () => `/review?mailbox=${org().mailbox.id}`;
const items = (page: Page) => page.locator("[data-review-item]");
const rightButton = (item: Locator) => item.getByRole("button", { name: en.rv_right, exact: true });
const answerOf = (item: Locator) => item.locator("[data-review=answer]");
const menuButton = (item: Locator) => item.getByRole("button", { name: en.rv_pick_label });
const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true });

// The labels of the mailbox as the Activity API reads them: the mails whose latest feedback has the source `review`.
async function reviewLabels(page: Page): Promise<{ emailId: string; verdict: string }[]> {
  const response = await page.request.get(`/api/activity?mailboxId=${org().mailbox.id}&limit=100`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    items: { emailId: string; feedback: { verdict: string; source: string } | null }[];
  };
  return body.items
    .filter((item) => item.feedback?.source === "review")
    .map((item) => ({ emailId: item.emailId, verdict: item.feedback?.verdict ?? "" }));
}

// Answers one open item with the mouse: `Right`, or (an unsure mail has no `Right`) a category from the menu; the pick saves at once.
async function answer(page: Page, item: Locator): Promise<void> {
  if ((await rightButton(item).count()) > 0) {
    await rightButton(item).click();
  } else {
    await menuButton(item).click();
    await menuItem(page, en.act_cat_needs_reply).click();
  }
  await expect(answerOf(item)).toBeVisible();
}

test("RV1: the report page links to the review; the review shows 10 decisions with their mail text and no address", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/report?mailbox=${org().mailbox.id}`);
  await expect(page.getByText(en.rep_review_suggest)).toBeVisible();
  await page.getByRole("link", { name: en.rep_review_link }).click();
  await expect(page).toHaveURL(new RegExp(`/review\\?mailbox=${org().mailbox.id}`));
  await expect(page.getByRole("heading", { level: 1, name: en.title_review })).toBeVisible();
  await expect(items(page)).toHaveCount(10);
  // Mail text of the stored rows: the sender's display name and the subject. The address never shows.
  await expect(
    items(page)
      .first()
      .getByText(/E2E review subject \d\d/)
  ).toBeVisible();
  await expect(
    items(page)
      .first()
      .getByText(/E2E Review Sender \d\d/)
  ).toBeVisible();
  await expect(page.locator("[data-review-item]").getByText(/@/)).toHaveCount(0);
  await expect(page.locator("[data-review=progress]")).toHaveText(t("rv_progress", { answered: 0, total: 10 }));
  // Not a required step: the page has no badge and the delegation category is absent from the menu (the organization has no delegate).
  await menuButton(items(page).first()).click();
  await expect(page.getByRole("menuitem")).toHaveCount(5);
  await expect(menuItem(page, en.act_cat_delegation)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: en.rv_done, exact: true })).toBeVisible();
  expect(await reviewLabels(page)).toEqual([]);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("RV2: a label with the keyboard and one with the mouse give 2 review rows", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reviewPath());
  await expect(items(page)).toHaveCount(10);
  const first = items(page).nth(0);
  const second = items(page).nth(1);
  const firstId = await first.getAttribute("data-review-item");
  const secondId = await second.getAttribute("data-review-item");

  // The keyboard reaches each control of an item: `Right`, then the menu button; Enter opens the menu and Enter on its first item saves.
  // The first mail may be an unsure one with no `Right`: this spec seeds 12 mails, and unsure is the seventh of them, so a sample can hold it anywhere.
  if ((await rightButton(first).count()) > 0) {
    await rightButton(first).focus();
    await page.keyboard.press("Tab");
    await expect(menuButton(first)).toBeFocused();
    await rightButton(first).focus();
    await page.keyboard.press("Enter");
  } else {
    await menuButton(first).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(answerOf(first)).toBeVisible();
  await expect(page.locator("[data-review=progress]")).toHaveText(t("rv_progress", { answered: 1, total: 10 }));

  await answer(page, second);
  await expect(page.locator("[data-review=progress]")).toHaveText(t("rv_progress", { answered: 2, total: 10 }));

  // The read-back: exactly these 2 mails have a feedback row with the source `review`.
  const labels = await reviewLabels(page);
  expect(labels.map((label) => label.emailId).sort()).toEqual([firstId, secondId].sort());
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("RV3: a member labels too; the labelled mails are not in the next sample", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await page.goto(reviewPath());
  // 12 mails, 2 labelled: the sample holds the 10 that are left.
  await expect(items(page)).toHaveCount(10);
  const labelled = new Set((await reviewLabels(page)).map((label) => label.emailId));
  expect(labelled.size).toBe(2);
  for (const id of await items(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-review-item"))
  )) {
    expect(labelled.has(id ?? "")).toBe(false);
  }
  await answer(page, items(page).first());
  expect((await reviewLabels(page)).length).toBe(3);
  expect(errors).toEqual([]);
});

test("RV4: `Done` ends the review with the thank-you and a link back; nothing is lost", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reviewPath());
  await expect(items(page)).toHaveCount(9);
  await answer(page, items(page).first());
  await page.getByRole("button", { name: en.rv_done, exact: true }).click();
  await expect(page.locator("[data-review=thanks]")).toContainText(en.rv_thanks);
  // The open items lose their controls; the answered one keeps its answer.
  await expect(page.getByRole("button", { name: en.rv_pick_label })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.rv_right, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.rv_done, exact: true })).toHaveCount(0);
  await expect(page.locator("[data-review=answer]")).toHaveCount(1);
  expect((await reviewLabels(page)).length).toBe(4);
  await expectNoA11yViolations(page);
  await page.getByRole("link", { name: en.rv_back }).click();
  await expect(page).toHaveURL(new RegExp(`/report\\?mailbox=${org().mailbox.id}`));
  expect(errors).toEqual([]);
});

test("RV5: after the last answer the thank-you shows by itself; 12 review rows in all", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reviewPath());
  await expect(items(page)).toHaveCount(8);
  for (let n = 0; n < 8; n += 1) await answer(page, items(page).nth(n));
  await expect(page.locator("[data-review=thanks]")).toContainText(en.rv_thanks);
  await expect(page.locator("[data-review=progress]")).toHaveText(t("rv_progress", { answered: 8, total: 8 }));
  const labels = await reviewLabels(page);
  expect(labels).toHaveLength(12);
  expect(new Set(labels.map((label) => label.emailId)).size).toBe(12);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("RV6: with nothing left to check the page says so and links back", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reviewPath());
  await expect(page.locator("[data-review=empty]")).toContainText(en.rv_empty);
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: en.rv_back })).toBeVisible();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("RV7: an organization without the flag sees the off text, no link on its report, and the routes answer 404", async ({
  context,
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const trust = readSeed().trustOrgs[project()];
  const errors = await startSession(context, page, trust.owner);
  await page.goto("/review");
  await expect(page.getByText(en.rep_off)).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests.filter((path) => path.startsWith("/api/review"))).toEqual([]);
  const sample = await page.request.get(`/api/review/sample?mailboxId=${trust.mailbox.id}`);
  expect(sample.status()).toBe(404);
  // The report page of that organization has no suggestion (the flag `trust_ladder` is on there, `panel_review` is not).
  await page.goto(`/report?mailbox=${trust.reportMailboxes.done.id}`);
  await expect(page.locator("[data-report-state=done]")).toBeVisible();
  await expect(page.getByText(en.rep_review_suggest)).toHaveCount(0);
  expect(errors).toEqual([]);
});
