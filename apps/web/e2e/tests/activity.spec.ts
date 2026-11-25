import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { ACTIVITY_SUBJECTS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { t } from "../../src/i18n";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL, e2eEnv, repoRoot } from "../env";
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

// The rule hit shows only while the flag `why_lines` is on. The CLI of the platform (`bun run org:flag`) with the
// e2e env, as the OAuth spec does. The flag is on for the seed organization only while this file runs.
function setFlag(flag: string, enabled: boolean): void {
  const { orgId } = readSeed();
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", flag, enabled ? "--on" : "--off"],
    { cwd: repoRoot, env: e2eEnv(), stdio: "pipe" }
  );
}

test.beforeAll(() => setFlag("why_lines", true));
test.afterAll(() => setFlag("why_lines", false));

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
  await expectNoA11yViolations(page);

  const moved = rowOf(page, ACTIVITY_SUBJECTS.moved);
  const reply = rowOf(page, ACTIVITY_SUBJECTS.reply);
  const unsure = rowOf(page, ACTIVITY_SUBJECTS.unsure);
  const delegated = rowOf(page, ACTIVITY_SUBJECTS.delegated);
  await expect(moved).toContainText(en.act_cat_notification);
  await expect(moved).toContainText(t("act_confidence", { value: 93 }));
  await expect(moved).toContainText("done: move to AI/Notifications, mark read");
  // ✅ shows on a label category only.
  await expect(unsure.getByRole("button", { name: rightLabel(en.act_cat_unsure) })).toHaveCount(0);
  await expect(delegated.getByRole("button", { name: rightLabel(en.act_cat_delegation) })).toHaveCount(0);
  await expect(delegated).toContainText(t("act_dlg_line", { name: "Ola", status: en.act_dlg_drafted }));

  // The rule hit shows on the row of a VIP result, and on no other row.
  await expect(reply).toContainText(en.act_rule_vip);
  await expect(moved).not.toContainText(en.act_rule_vip);

  // The panel.
  await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(en.act_panel_title)).toBeVisible();
  await expect(panel).toContainText("Automated shipping update.");
  await expect(panel).toContainText("done: move to AI/Notifications");
  await expect(panel).toContainText("done: mark read");
  await expectNoA11yViolations(page);
  await expect(panel).not.toContainText(en.act_rule_hit_vip);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The panel of the VIP result names the rule.
  await reply.getByText(ACTIVITY_SUBJECTS.reply).click();
  await expect(page.getByRole("dialog")).toContainText(en.act_rule_hit_vip);
  await expectNoA11yViolations(page);
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

  const notRated = page.getByRole("button", { name: en.act_not_rated });
  await expect(notRated).toHaveAttribute("aria-pressed", "false");
  await notRated.click();
  await expect(page).toHaveURL(/notRated=1/);
  await expect(notRated).toHaveAttribute("aria-pressed", "true");
  await expect(moved).toHaveCount(0);
  await expect(reply).toBeVisible();
  await notRated.click();
  await expect(page).not.toHaveURL(/notRated/);
  await expect(moved).toBeVisible();

  await expect(page.getByRole("button", { name: en.act_range_7d })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: en.act_load_more }).click();
  await expect(rows).toHaveCount(56);
  await expect(page.getByRole("button", { name: en.act_load_more })).toHaveCount(0);
});

// The sender line of the panel. The seed writes the profiles of two senders (`seedActivityProfiles`); the flag `sender_context` is
// on for the seed organization only inside this test.
test("the panel shows the sender line only with the flag on and a profile", async ({ page }) => {
  const moved = rowOf(page, ACTIVITY_SUBJECTS.moved);
  const reply = rowOf(page, ACTIVITY_SUBJECTS.reply);
  const shopLine = `${t("sender_rel_new")} · ${t("sender_answered", { answered: 0, received: 1, days: 90 })} · ${t("sender_last_seen_today")}`;
  const annaLine = [
    t("sender_rel_known"),
    t("sender_answered", { answered: 6, received: 8, days: 90 }),
    t("sender_wrote", { userMailsTo: 3 }),
    t("sender_last_seen", { n: 2 }),
  ].join(" · ");

  // The flag is off: the answer has no `sender` key and the panel no line.
  await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
  await expect(page.getByRole("dialog")).toContainText(en.act_panel_title);
  await expect(page.getByRole("dialog")).not.toContainText(en.sender_rel_new);
  await page.keyboard.press("Escape");

  setFlag("sender_context", true);
  try {
    await page.reload();
    await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
    await expect(page.getByRole("dialog")).toContainText(shopLine);
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await reply.getByText(ACTIVITY_SUBJECTS.reply).click();
    await expect(page.getByRole("dialog")).toContainText(annaLine);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // `sender: null` (no profile, a cleared address): the panel has no line.
    await page.route("**/api/activity*", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { items: { sender?: unknown }[] };
      for (const entry of body.items) entry.sender = null;
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await moved.getByText(ACTIVITY_SUBJECTS.moved).click();
    await expect(page.getByRole("dialog")).toContainText(en.act_panel_title);
    await expect(page.getByRole("dialog")).not.toContainText(en.sender_rel_new);
  } finally {
    setFlag("sender_context", false);
  }
});

test("Right and Change the category save feedback", async ({ page }) => {
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
  await page.getByRole("dialog").getByRole("button", { name: en.act_cat_info }).click();
  await expect(
    page.getByText(t("act_toast_picked", { category: en.act_cat_info, ai: en.act_cat_needs_reply }))
  ).toBeVisible();
});

test("Undo starts the Undo", async ({ page }) => {
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

test("range and not-rated chips live in the URL and reload the list", async ({ page }) => {
  const range30 = page.getByRole("button", { name: en.act_range_30d });
  await range30.click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(range30).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: en.act_range_7d })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("li[data-email-id]").first()).toBeVisible();

  await page.getByRole("button", { name: en.act_not_rated }).click();
  await expect(page).toHaveURL(/notRated=1/);
  await page.reload();
  await expect(page.getByRole("button", { name: en.act_not_rated })).toHaveAttribute("aria-pressed", "true");
  await expect(range30).toHaveAttribute("aria-pressed", "true");
});

test("the rows sit in day groups under the page lead", async ({ page }) => {
  await expect(page.getByText(t("act_lead", { days: 7 }))).toBeVisible();
  const days = page.locator('section[aria-labelledby^="act-day-"]');
  const headings = days.locator("h2");
  await expect(headings.first()).toBeVisible();
  await expect(headings).toHaveCount(await days.count());
  // Each day has one heading, even when a later page of the list continues it.
  const texts = await headings.allTextContents();
  expect(new Set(texts).size).toBe(texts.length);
  await page.getByRole("button", { name: en.act_load_more }).click();
  await expect(page.locator("li[data-email-id]")).toHaveCount(56);
  const after = await headings.allTextContents();
  expect(new Set(after).size).toBe(after.length);
});

test("a filter that matches nothing shows the empty state and Clear filters empties the URL", async ({ page }) => {
  await pickCategory(page, en.act_cat_spam);
  await expect(page).toHaveURL(/category=spam/);
  await expect(page.getByRole("heading", { name: en.act_empty_filters_title })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: en.act_clear_filters }).click();
  await expect(page).not.toHaveURL(/\?/);
  await expect(page.locator("li[data-email-id]").first()).toBeVisible();
});

test("the page has one visible h1 and it is the page title", async ({ page }) => {
  const headings = page.getByRole("heading", { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText(en.title_activity);
  await expect(headings).toBeVisible();
});
