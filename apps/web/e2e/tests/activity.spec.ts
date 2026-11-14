import { expect, test, type Page } from "@playwright/test";

import { ACTIVITY_SUBJECTS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { t } from "../../src/i18n";
import { E2E_BASE_URL } from "../env";
import {
  cleanUpOrg,
  connectGreenMail,
  cspErrors,
  mailboxAddress,
  nextAddress,
  seedActivity,
  signInAs,
} from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The earlier blocks are 10, 40, 60, 70, 80 (and their +100 twins); this spec uses 90 and 190.
function addressBase(project: string): number {
  return project === "mobile" ? 90 : 190;
}

test.beforeEach(async ({ context, page }, testInfo) => {
  // A GreenMail connect, the seed script and a long first test.
  test.setTimeout(90_000);
  const project = testInfo.project.name;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(addressBase(project)) });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/mailboxes?connect=1");
  await connectGreenMail(page, project);

  const list = await page.request.get("/api/mailboxes");
  const mailboxes = (await list.json()) as { id: string; address: string }[];
  const mailbox = mailboxes.find((entry) => entry.address === mailboxAddress(project));
  if (mailbox === undefined) throw new Error("the connected mailbox is not in the list");
  seedActivity(mailbox.id);
  await page.goto("/activity");
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

function rowOf(page: Page, subject: string) {
  return page.locator("li[data-email-id]").filter({ hasText: subject });
}

async function pickCategory(page: Page, option: string): Promise<void> {
  await page.getByRole("combobox", { name: en.act_filter_category }).click();
  await page.getByRole("option", { name: option }).click();
}

const rightLabel = (category: string): string => t("act_btn_right", { category });

test("rows, panel, filters and load more", async ({ page }) => {
  const rows = page.locator("li[data-email-id]");
  await expect(rows).toHaveCount(50);
  await expect(page.getByText(/^Updated /)).toBeVisible();

  const moved = rowOf(page, ACTIVITY_SUBJECTS.moved);
  const reply = rowOf(page, ACTIVITY_SUBJECTS.reply);
  const unsure = rowOf(page, ACTIVITY_SUBJECTS.unsure);
  const delegated = rowOf(page, ACTIVITY_SUBJECTS.delegated);
  await expect(moved).toContainText(en.act_tag_notification);
  await expect(moved).toContainText(t("act_confidence", { value: 93 }));
  await expect(moved).toContainText("done: move to AI/Notifications, mark read");
  // ✅ shows on a label category only.
  await expect(unsure.getByRole("button", { name: rightLabel(en.act_cat_unsure) })).toHaveCount(0);
  await expect(delegated.getByRole("button", { name: rightLabel(en.act_cat_delegation) })).toHaveCount(0);
  await expect(delegated).toContainText(t("act_dlg_line", { name: "Ola", status: en.act_dlg_drafted }));

  // The panel.
  await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(en.act_panel_title)).toBeVisible();
  await expect(panel).toContainText("Automated shipping update.");
  await expect(panel).toContainText("done: move to AI/Notifications");
  await expect(panel).toContainText("done: mark read");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The category filter lives in the URL and survives a reload.
  await pickCategory(page, en.act_needs_action);
  await expect(page).toHaveURL(/category=action/);
  await expect(reply).toBeVisible();
  await expect(unsure).toBeVisible();
  await expect(moved).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/category=action/);
  await expect(reply).toBeVisible();
  await expect(moved).toHaveCount(0);

  await pickCategory(page, en.act_all_categories);
  await expect(moved).toBeVisible();
  await moved.getByRole("button", { name: rightLabel(en.act_cat_notification) }).click();
  await expect(page.getByText(t("act_toast_right", { category: en.act_cat_notification }))).toBeVisible();

  const notRated = page.getByRole("switch", { name: en.act_not_rated });
  await notRated.click();
  await expect(moved).toHaveCount(0);
  await expect(reply).toBeVisible();
  await notRated.click();
  await expect(moved).toBeVisible();

  await expect(page.getByRole("combobox", { name: en.act_filter_range })).toHaveText(en.act_range_7d);
  await page.getByRole("button", { name: en.act_load_more }).click();
  await expect(rows).toHaveCount(56);
  await expect(page.getByRole("button", { name: en.act_load_more })).toHaveCount(0);
});

test("✅ and ✏️ save feedback", async ({ page }) => {
  const moved = rowOf(page, ACTIVITY_SUBJECTS.moved);
  const rightMoved = rightLabel(en.act_cat_notification);
  await moved.getByRole("button", { name: rightMoved }).click();
  await expect(page.getByText(t("act_toast_right", { category: en.act_cat_notification }))).toBeVisible();

  await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(en.act_fb_right)).toBeVisible();
  // The buttons inside the open panel (a bottom sheet on a phone) must be reachable.
  await panel.getByRole("button", { name: rightMoved }).click();
  await expect(page.getByText(en.act_toast_same)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const reply = rowOf(page, ACTIVITY_SUBJECTS.reply);
  await reply.getByRole("button", { name: en.act_btn_edit }).click();
  await expect(page.getByRole("dialog").getByText(en.act_pick_title)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: en.act_tag_info }).click();
  await expect(
    page.getByText(t("act_toast_picked", { category: en.act_cat_info, ai: en.act_cat_needs_reply }))
  ).toBeVisible();
});

test("↩️ starts the Undo", async ({ page }) => {
  const moved = rowOf(page, ACTIVITY_SUBJECTS.moved);
  await moved.getByRole("button", { name: en.act_btn_undo, exact: true }).click();
  await expect(page.getByText(en.undo_started)).toBeVisible();
  await expect(moved.getByRole("button", { name: en.act_btn_undo, exact: true })).toHaveCount(0);
  await expect(moved).toContainText(en.act_undo_pending);
});

test("another organization's mail is not found", async ({ page }) => {
  const { emailId } = readSeed().otherOrg;
  const headers = { origin: E2E_BASE_URL };
  const feedback = await page.request.post("/api/feedback", { headers, data: { emailId, trueCategory: "info" } });
  expect(feedback.status()).toBe(404);
  expect(await feedback.json()).toEqual({ error: "not_found" });
  const undo = await page.request.post("/api/actions/undo", { headers, data: { emailId } });
  expect(undo.status()).toBe(404);
  expect(await undo.json()).toEqual({ error: "not_found" });
});

test("an assistant member rates mail", async ({ browser }, testInfo) => {
  const project = testInfo.project.name as "mobile" | "desktop";
  const member = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(addressBase(project)) },
  });
  try {
    const memberPage = await member.newPage();
    await signInAs(memberPage, readSeed().activityMembers[project]);
    await expect(memberPage).toHaveURL(/\/onboarding$/);
    await memberPage.goto("/activity");
    const reply = rowOf(memberPage, ACTIVITY_SUBJECTS.reply);
    await expect(reply).toBeVisible();
    await reply.getByRole("button", { name: rightLabel(en.act_cat_needs_reply) }).click();
    await expect(memberPage.getByText(t("act_toast_right", { category: en.act_cat_needs_reply }))).toBeVisible();
  } finally {
    await member.close();
  }
});
