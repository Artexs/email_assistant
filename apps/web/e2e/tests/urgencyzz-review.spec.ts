import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { E2E_URGENCY_SEEDED } from "../../../server/src/scripts/e2e-seed-args";
import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { E2E_BASE_URL } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// Checks from the review of the urgency card (focus of the deadline buttons, a save that keeps the ended deadline, reload after a removal,
// the keyword error, the member write). The file name sorts after `urgency.spec.ts`: it uses the seed state that file leaves
// (the `empty` mailbox cleared, the `seeded` one untouched), and a name that sorts before it would change that state.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().urgencyOrgs[project()];

// Documentation range 192.0.2.0/24, a block per project, away from the blocks of `urgency.spec.ts`.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 60 : 200) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const card = (page: Page) => page.locator("[data-card=urgency]");

async function openCard(page: Page, which: "seeded" | "empty"): Promise<void> {
  await page.goto("/rules");
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

interface Stored {
  topics: unknown[];
  deadlines: { label: string }[];
}

async function storedProfile(page: Page, mailboxId: string): Promise<Stored | null> {
  const response = await page.request.get(`/api/settings/${mailboxId}`);
  return ((await response.json()) as { urgencyProfile: Stored | null }).urgencyProfile;
}

function watchPuts(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.endsWith("/urgency")) {
      bodies.push(request.postDataJSON());
    }
  });
  return bodies;
}

const deadlineLabels = (profile: Stored | null) => profile?.deadlines.map((deadline) => deadline.label);
const bothDeadlines = [E2E_URGENCY_SEEDED.endedLabel, E2E_URGENCY_SEEDED.futureLabel];

test("R1a: Add a deadline moves the focus to the name of the new row", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page, "seeded");
  const form = card(page);
  await form.getByRole("button", { name: en.urg_deadline_add }).click();
  await expect(form.getByLabel(t("urg_deadline_name_label", { n: 3 }))).toBeFocused();
  expect(errors).toEqual([]);
});

test("R1b: removing a deadline puts the focus on Add a deadline", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page, "seeded");
  const form = card(page);
  await form.getByRole("button", { name: t("urg_deadline_remove", { n: 1 }) }).click();
  await expect(form.getByRole("button", { name: en.urg_deadline_add })).toBeFocused();
  expect(errors).toEqual([]);
});

test("R2: a save after another edit keeps the ended deadline in the PUT and in the store", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "seeded");
  const form = card(page);
  await form.getByLabel(t("urg_topic_name_label", { n: 1 })).fill(`${E2E_URGENCY_SEEDED.topic.label} R2`);
  await form.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.urg_saved_toast)).toBeVisible();
  expect(puts).toHaveLength(1);
  const sent = (puts[0] as { profile: Stored }).profile;
  expect(deadlineLabels(sent)).toEqual(bothDeadlines);
  expect(deadlineLabels(await storedProfile(page, org().seeded.id))).toEqual(bothDeadlines);
  await expect(form.locator("[data-ended=true]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("R3: an unsaved removal comes back on reload; a saved removal stays gone; the ended row stays", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page, "seeded");
  const form = card(page);
  const second = form.getByLabel(t("urg_deadline_name_label", { n: 2 }));
  await form.getByRole("button", { name: t("urg_deadline_remove", { n: 2 }) }).click();
  await expect(second).toHaveCount(0);
  await openCard(page, "seeded");
  await expect(second).toHaveValue(E2E_URGENCY_SEEDED.futureLabel);

  await form.getByRole("button", { name: t("urg_deadline_remove", { n: 2 }) }).click();
  await form.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.urg_saved_toast)).toBeVisible();
  await openCard(page, "seeded");
  await expect(second).toHaveCount(0);
  await expect(form.getByLabel(t("urg_deadline_name_label", { n: 1 }))).toHaveValue(E2E_URGENCY_SEEDED.endedLabel);
  await expect(form.locator("[data-ended=true]")).toHaveCount(1);
  expect(deadlineLabels(await storedProfile(page, org().seeded.id))).toEqual([E2E_URGENCY_SEEDED.endedLabel]);
  expect(errors).toEqual([]);
});

test("R4: a keyword error marks the keywords field invalid and sends nothing", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  const puts = watchPuts(page);
  await openCard(page, "empty");
  const form = card(page);
  await form.getByRole("button", { name: en.urg_topic_add }).click();
  const name = form.getByLabel(t("urg_topic_name_label", { n: 1 }));
  const keywords = form.getByLabel(t("urg_topic_keywords_label", { n: 1 }));
  await name.fill("<img src=x onerror=window.__pwned=1> **bold**");

  await keywords.fill("k".repeat(41));
  await form.getByRole("button", { name: en.save }).click();
  await expect(form.getByRole("alert")).toHaveText(t("urg_err_keyword", { n: 1 }));
  await expect(keywords).toHaveAttribute("aria-invalid", "true");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");

  await keywords.fill("a, b, c, d, e, f, g, h, i, j, k");
  await form.getByRole("button", { name: en.save }).click();
  await expect(form.getByRole("alert")).toHaveText(t("urg_err_keywords_many", { n: 1 }));
  await expect(keywords).toHaveAttribute("aria-invalid", "true");
  expect(puts).toEqual([]);

  // A good value clears the mark and saves the markup as text.
  await keywords.fill("a");
  await expect(keywords).not.toHaveAttribute("aria-invalid", "true");
  await form.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.urg_saved_toast)).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("R5: a member session cannot PUT the profile; the markup of a label shows as text", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  const response = await page.request.put(`/api/settings/${org().empty.id}/urgency`, {
    headers: { origin: E2E_BASE_URL, "content-type": "application/json" },
    data: { profile: null },
  });
  expect(response.status()).toBe(403);
  expect(await storedProfile(page, org().empty.id)).not.toBeNull();
  await openCard(page, "empty");
  await expect(card(page).getByText("<img src=x onerror=window.__pwned=1> **bold**")).toBeVisible();
  await expect(card(page).locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});
