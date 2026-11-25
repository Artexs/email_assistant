import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_URGENCY_SEEDED } from "../../../server/src/scripts/e2e-seed-args";
import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The urgency organization of the project (see `e2e-seed.ts`): the flag `urgency_editor` is on and there are two mailboxes. `seeded` holds a
// topic, a deadline of yesterday and one in ten days; `empty` holds no profile. The tests change the profile of `empty`, so the tests of a
// project run in this order: add and save, the label error, the ended deadline, the member, the keyboard, and last Clear all.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().urgencyOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 192.0.2.0/24,
// a block per project, away from the ranges of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 10 : 130) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const card = (page: Page) => page.locator("[data-card=urgency]");

// Opens the Rules page and shows the settings of one mailbox of the organization in the card.
async function openCard(page: Page, which: "seeded" | "empty"): Promise<void> {
  await page.goto("/rules");
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole("heading", { name: en.urg_topics_title })).toBeVisible();
  const mailbox = org()[which];
  const select = card(page).getByRole("combobox", { name: en.urg_mailbox_label });
  if (!(await select.innerText()).includes(mailbox.address)) {
    const loaded = page.waitForResponse((response) => response.url().endsWith(`/api/settings/${mailbox.id}`));
    await select.click();
    await page.getByRole("option", { name: mailbox.address }).click();
    await loaded;
  }
  await expect(select).toHaveText(mailbox.address);
  await expect(card(page).getByRole("heading", { name: en.urg_topics_title })).toBeVisible();
}

// The stored profile of a mailbox, as the settings route of the panel returns it.
async function storedProfile(page: Page, mailboxId: string): Promise<unknown> {
  const response = await page.request.get(`/api/settings/${mailboxId}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { urgencyProfile: unknown }).urgencyProfile;
}

// The PUT requests to the urgency route of the page, in order, with their JSON bodies.
function watchPuts(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.endsWith("/urgency")) {
      bodies.push(request.postDataJSON());
    }
  });
  return bodies;
}

const topicName = (n: number) => t("urg_topic_name_label", { n });
const topicKeywords = (n: number) => t("urg_topic_keywords_label", { n });
const deadlineName = (n: number) => t("urg_deadline_name_label", { n });
const deadlineDate = (n: number) => t("urg_deadline_date_label", { n });

test("T1: add a topic with 2 keywords and a deadline, save, reload: both show and the settings view returns them", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "empty");
  const form = card(page);
  await expect(form.getByText(en.urg_topics_empty)).toBeVisible();
  await expect(form.getByText(en.urg_deadlines_empty)).toBeVisible();
  // Nothing is stored and nothing is changed: no Save and no Clear all yet.
  await expect(form.getByRole("button", { name: en.save })).toBeDisabled();
  await expect(form.getByRole("button", { name: en.urg_clear })).toHaveCount(0);

  await form.getByRole("button", { name: en.urg_topic_add }).click();
  // The new row takes the focus.
  await expect(form.getByLabel(topicName(1))).toBeFocused();
  await form.getByLabel(topicName(1)).fill("Budget review");
  await form.getByLabel(topicKeywords(1)).fill("budget, invoice");
  await form.getByRole("button", { name: en.urg_deadline_add }).click();
  await form.getByLabel(deadlineName(1)).fill("Grant report");
  await form.getByLabel(deadlineDate(1)).fill("2099-12-31");
  await form.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.urg_saved_toast)).toBeVisible();

  const expected = {
    topics: [{ label: "Budget review", keywords: ["budget", "invoice"] }],
    deadlines: [{ label: "Grant report", due: "2099-12-31" }],
  };
  expect(puts).toEqual([{ profile: expected }]);
  expect(await storedProfile(page, org().empty.id)).toEqual(expected);

  await openCard(page, "empty");
  await expect(form.getByLabel(topicName(1))).toHaveValue("Budget review");
  await expect(form.getByLabel(topicKeywords(1))).toHaveValue("budget, invoice");
  await expect(form.getByLabel(deadlineName(1))).toHaveValue("Grant report");
  await expect(form.getByLabel(deadlineDate(1))).toHaveValue("2099-12-31");
  // The deadline is far ahead: it has not ended.
  await expect(form.locator("[data-ended=true]")).toHaveCount(0);
  await expect(form.getByRole("button", { name: en.urg_clear })).toBeVisible();
  expect(errors).toEqual([]);
});

test("T2: a label of 81 characters shows the error and sends nothing", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "empty");
  const form = card(page);
  await form.getByRole("button", { name: en.urg_topic_add }).click();
  // The saved topic is row 1; the new empty one is row 2.
  await form.getByLabel(topicName(2)).fill("x".repeat(81));
  await form.getByRole("button", { name: en.save }).click();
  await expect(form.getByRole("alert")).toHaveText(t("urg_err_topic_label", { n: 2 }));
  await expect(form.getByLabel(topicName(2))).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(page);
  expect(puts).toEqual([]);

  // 80 characters pass the check: the error goes away when the text changes.
  await form.getByLabel(topicName(2)).fill("x".repeat(80));
  await expect(form.getByRole("alert")).toHaveCount(0);
  // A deadline without a date is refused the same way.
  await form.getByRole("button", { name: t("urg_topic_remove", { n: 2 }) }).click();
  await form.getByRole("button", { name: en.urg_deadline_add }).click();
  await form.getByLabel(deadlineName(2)).fill("No date");
  await form.getByRole("button", { name: en.save }).click();
  await expect(form.getByRole("alert")).toHaveText(t("urg_err_deadline_date", { n: 2 }));
  expect(puts).toEqual([]);
  expect(await storedProfile(page, org().empty.id)).toMatchObject({ topics: [{ label: "Budget review" }] });
  expect(errors).toEqual([]);
});

test("T3: a deadline of yesterday shows struck out with ended, and the card does not delete it", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "seeded");
  const form = card(page);
  const ended = form.locator("[data-ended=true]");
  await expect(ended).toHaveCount(1);
  await expect(ended.getByLabel(deadlineName(1))).toHaveValue(E2E_URGENCY_SEEDED.endedLabel);
  await expect(ended.getByLabel(deadlineName(1))).toHaveCSS("text-decoration-line", "line-through");
  await expect(ended.getByText(en.urg_ended, { exact: true })).toBeVisible();
  // The deadline in ten days is a normal row.
  const future = form.getByLabel(deadlineName(2));
  await expect(future).toHaveValue(E2E_URGENCY_SEEDED.futureLabel);
  await expect(future).not.toHaveCSS("text-decoration-line", "line-through");
  // Still stored: opening the card changed nothing.
  expect(puts).toEqual([]);
  const stored = (await storedProfile(page, org().seeded.id)) as { deadlines: { label: string }[] };
  expect(stored.deadlines.map((deadline) => deadline.label)).toEqual([
    E2E_URGENCY_SEEDED.endedLabel,
    E2E_URGENCY_SEEDED.futureLabel,
  ]);
  expect(errors).toEqual([]);
});

test("T4: a member sees the profile and no control to change it", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await openCard(page, "seeded");
  const form = card(page);
  await expect(form.getByText(E2E_URGENCY_SEEDED.topic.label)).toBeVisible();
  await expect(form.getByText(E2E_URGENCY_SEEDED.topic.keywords.join(", "), { exact: false })).toBeVisible();
  await expect(form.getByText(E2E_URGENCY_SEEDED.endedLabel)).toBeVisible();
  await expect(form.getByText(en.urg_ended)).toBeVisible();
  for (const name of [en.save, en.urg_clear, en.urg_topic_add, en.urg_deadline_add]) {
    await expect(form.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(form.getByRole("textbox")).toHaveCount(0);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

// Presses Tab until the element has the focus; fails after `max` presses.
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let press = 0; press < max; press += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`the keyboard did not reach the element in ${max} presses`);
}

test("T5: no accessibility violation with the card; the keyboard reaches add, remove and save", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page, "seeded");
  const form = card(page);
  await expectNoA11yViolations(page);

  // A change makes Save available (a disabled button takes no focus).
  const name = form.getByLabel(topicName(1));
  await name.fill(`${E2E_URGENCY_SEEDED.topic.label} 2`);
  await form.getByRole("combobox", { name: en.urg_mailbox_label }).focus();
  const removeTopic = form.getByRole("button", { name: t("urg_topic_remove", { n: 1 }) });
  const addTopic = form.getByRole("button", { name: en.urg_topic_add });
  const removeDeadline = form.getByRole("button", { name: t("urg_deadline_remove", { n: 1 }) });
  const addDeadline = form.getByRole("button", { name: en.urg_deadline_add });
  const save = form.getByRole("button", { name: en.save });
  await tabTo(page, removeTopic);
  await tabTo(page, addTopic);
  await tabTo(page, removeDeadline);
  await tabTo(page, addDeadline);
  await tabTo(page, form.getByRole("link", { name: en.urg_vip_link }));
  await tabTo(page, save);

  // Enter on Add moves the focus into the new row; Enter on Remove puts it back on Add.
  await addTopic.focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel(topicName(2))).toBeFocused();
  // With two topics and a deadline the page does not scroll sideways, also on the phone project.
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  await form.getByRole("button", { name: t("urg_topic_remove", { n: 2 }) }).focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel(topicName(2))).toHaveCount(0);
  await expect(addTopic).toBeFocused();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T6: Clear all asks first; Cancel sends nothing; Confirm sends a null profile", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "empty");
  const form = card(page);
  const dialog = page.getByRole("dialog", { name: en.urg_clear_title });

  await form.getByRole("button", { name: en.urg_clear }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(org().empty.address);
  await expectNoA11yViolations(page, { include: "[role=dialog]" });
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toHaveCount(0);
  expect(puts).toEqual([]);
  expect(await storedProfile(page, org().empty.id)).not.toBeNull();

  await form.getByRole("button", { name: en.urg_clear }).click();
  await dialog.getByRole("button", { name: en.urg_clear }).click();
  await expect(page.getByText(en.urg_cleared_toast)).toBeVisible();
  expect(puts).toEqual([{ profile: null }]);
  expect(await storedProfile(page, org().empty.id)).toBeNull();
  await expect(form.getByText(en.urg_topics_empty)).toBeVisible();
  await expect(form.getByRole("button", { name: en.urg_clear })).toHaveCount(0);
  // The other mailbox keeps its profile.
  expect(await storedProfile(page, org().seeded.id)).not.toBeNull();
  expect(errors).toEqual([]);
});

test("T7: with the flag off the Rules page has no urgency card, though the organization has a mailbox", async ({
  context,
  page,
}) => {
  // The paused organization: one mailbox and no flag `urgency_editor`.
  const errors = await startSession(context, page, readSeed().pausedOwner);
  const settingsRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/settings/")) settingsRequests.push(request.url());
  });
  await page.goto("/rules");
  await expect(page.locator("[data-kind=vip]")).toBeVisible();
  const mailboxes = await page.request.get("/api/mailboxes");
  expect(((await mailboxes.json()) as unknown[]).length).toBe(1);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(en.urg_title)).toHaveCount(0);
  expect(settingsRequests).toEqual([]);
  expect(errors).toEqual([]);
});
