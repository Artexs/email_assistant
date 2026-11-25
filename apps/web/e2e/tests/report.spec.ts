import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";

// The report page. It runs on the trust organization of the project (see `e2e-seed.ts`): `flag trust_ladder` on, the server
// reads the gate fixture folder (`info`, `notification` and `spam` all `go`). Besides the mailbox of the card spec the organization has three
// mailboxes, one state each (`e2e-trust-rows.ts`): `done` (shadow mode; `notification` recommended, `spam` failed by the history, `info`
// paused), `running` (a check that classifies) and `noResult` (`no_history`; all three moving categories recommended). The tests of a project
// run in this order; the two taps come last, because they change the mailboxes.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().trustOrgs[project()];
const boxes = () => org().reportMailboxes;

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 192.0.2.0/24, a block
// per project, away from the blocks of the card, urgency and newsletters specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 115 : 215) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const reportPath = (mailboxId: string) => `/report?mailbox=${mailboxId}`;
const category = (page: Page, name: "info" | "notification" | "spam") => page.locator(`article[data-category=${name}]`);
const turnOn = (page: Page, categories: string) =>
  page.getByRole("button", { name: t("rep_turn_on", { categories }), exact: true });
const proof = t("trust_proof_go", { percent: "99.1", cases: 200 });

interface TrustAnswer {
  mode: string;
  categories: Record<string, { auto: boolean; grantBy: string | null }>;
}
async function trustOf(page: Page, mailboxId: string): Promise<TrustAnswer> {
  const response = await page.request.get(`/api/trust/${mailboxId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as TrustAnswer;
}

test("R1: a done check shows counts, the proof, the history line and the pause per category, and names the due category on the button", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reportPath(boxes().done.id));
  await expect(page.locator("[data-report-state=done]")).toBeVisible();
  // The summary counts the stored items of the check (the seed stores none); the per-category counts come from the stored result.
  await expect(page.getByText(t("rep_checked", { checked: 0 }), { exact: true })).toBeVisible();
  // Counts only: the seeded result holds 200 mails checked and 40 that the category would move.
  await expect(category(page, "notification").getByText(t("rep_counts", { total: 200, wouldMove: 40 }))).toBeVisible();
  await expect(category(page, "notification").getByText(proof, { exact: true })).toBeVisible();
  await expect(category(page, "notification").getByText(en.trust_mail_pass, { exact: true })).toBeVisible();
  await expect(category(page, "notification").getByText(en.rep_recommended, { exact: true })).toBeVisible();
  await expect(
    category(page, "spam").getByText(t("trust_mail_fail", { moved: 6, acted: 60 }), { exact: true })
  ).toBeVisible();
  await expect(category(page, "spam").getByText(en.rep_not_recommended, { exact: true })).toBeVisible();
  await expect(category(page, "info").getByText(en.trust_paused_corrections, { exact: true })).toBeVisible();
  await expect(turnOn(page, en.cat_notification)).toBeVisible();
  await expect(page.getByText(en.rep_read_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.rep_check_again })).toBeVisible();
  // The suggestion of the panel review shows only with the flag `panel_review`: this organization has it off (review.spec.ts has it on).
  await expect(page.getByText(en.rep_review_suggest)).toHaveCount(0);
  // No mail text: the report shows no sender name, subject or address of a mail. (The selector above it names the user's own mailboxes.)
  await expect(page.locator("[data-report-state]").getByText(/@/)).toHaveCount(0);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("R2: a member sees the same text and no button", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await page.goto(reportPath(boxes().done.id));
  await expect(category(page, "notification").getByText(proof, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Turn on recommended/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.rep_check_again })).toHaveCount(0);
  await expect(page.getByText(en.rep_owner_only)).toBeVisible();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("R3: a running check shows the progress text and no result and no button", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reportPath(boxes().running.id));
  await expect(page.getByText(t("rep_progress", { checked: 0, max: 500 }), { exact: true })).toBeVisible();
  await expect(page.locator("[data-category]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Turn on recommended|^Check again/ })).toHaveCount(0);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("R4: no mailbox in the address shows the newest mailbox; the selector switches the mailbox", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/report");
  // The newest connected mailbox is `noResult` (the seed creates it last).
  await expect(page.locator("[data-report-state=no_result]")).toBeVisible();
  await expect(page.getByText(en.rep_nr_no_history, { exact: true })).toBeVisible();
  await page.getByLabel(en.set_mailbox_label).click();
  await page.getByRole("option", { name: boxes().running.address }).click();
  await expect(page.getByText(t("rep_progress", { checked: 0, max: 500 }), { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`mailbox=${boxes().running.id}`));
  expect(errors).toEqual([]);
});

test("pictures of a done, a running and a no_result check are saved in the contact sheet folder", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project saves the pictures: the sizes are set here");
  const folder = join(sheetDir(), "f170-09");
  mkdirSync(folder, { recursive: true });
  const errors = await startSession(context, page, org().owner);
  const viewports = { phone: { width: 412, height: 915 }, desktop: { width: 1280, height: 800 } } as const;
  const states = [
    { name: "done", id: boxes().done.id, ready: page.locator("[data-report-state=done]") },
    { name: "running", id: boxes().running.id, ready: page.locator("[data-report-state=running]") },
    { name: "no-result", id: boxes().noResult.id, ready: page.locator("[data-report-state=no_result]") },
  ];
  for (const state of states) {
    await page.goto(reportPath(state.id));
    await expect(state.ready).toBeVisible();
    for (const [viewport, size] of Object.entries(viewports)) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({
          path: join(folder, `report-${state.name}-${viewport}-${scheme}-en.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  }
  expect(errors).toEqual([]);
});

test("R5: a no_result check shows its sentence and the button; the tap turns the recommended categories on", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(reportPath(boxes().noResult.id));
  await expect(page.getByText(en.rep_nr_no_history, { exact: true })).toBeVisible();
  await expect(category(page, "notification").getByText(en.trust_mail_few, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  const names = [en.cat_info, en.cat_notification, en.cat_spam].join(", ");
  await turnOn(page, names).click();
  await expect(page.getByRole("status")).toContainText(t("rep_turned_on", { categories: names }));
  // The read-back: the three categories are on, granted as recommended.
  const view = await trustOf(page, boxes().noResult.id);
  for (const name of ["info", "notification", "spam"]) {
    expect(view.categories[name]).toMatchObject({ auto: true, grantBy: "recommended" });
  }
  // Nothing is due any more: no button, and the note says why.
  await expect(page.getByRole("button", { name: /^Turn on recommended/ })).toHaveCount(0);
  await expect(page.getByText(en.rep_all_on)).toBeVisible();
  expect(errors).toEqual([]);
});

test("R6: the tap on a shadow mailbox turns `notification` on and sets the mode to assist", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  expect((await trustOf(page, boxes().done.id)).mode).toBe("shadow");
  await page.goto(reportPath(boxes().done.id));
  await turnOn(page, en.cat_notification).click();
  await expect(page.getByRole("status")).toContainText(
    `${t("rep_turned_on", { categories: en.cat_notification })} ${en.rep_mode_assist}`
  );
  const view = await trustOf(page, boxes().done.id);
  expect(view.mode).toBe("assist");
  expect(view.categories.notification).toMatchObject({ auto: true, grantBy: "recommended" });
  // `spam` failed and `info` is paused: the tap did not touch them.
  expect(view.categories.spam?.auto).toBe(false);
  expect(view.categories.info?.auto).toBe(false);
  await expect(page.getByRole("button", { name: /^Turn on recommended/ })).toHaveCount(0);
  await page.reload();
  await expect(category(page, "notification").getByText(en.rep_auto_on, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("R7: an organization without the flag shows the off text and asks for no trust view", async ({
  context,
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const off = readSeed().urgencyOrgs[project()];
  const errors = await startSession(context, page, off.owner);
  await page.goto("/report");
  await expect(page.getByText(en.rep_off)).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests.filter((path) => path.startsWith("/api/trust"))).toEqual([]);
  expect(errors).toEqual([]);
});

test("R8: with the flag on, onboarding leads to the report and has no mode step; the report item is done once a check ended", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: en.ob_report_title })).toBeVisible();
  await expect(page.getByRole("heading", { name: en.ob_channel_title })).toBeVisible();
  await expect(page.getByRole("heading", { name: en.ob_mode_title })).toHaveCount(0);
  // A check of the organization has ended (the seed): the item reads done and links to the report.
  await expect(page.getByText(en.ob_report_done)).toBeVisible();
  await expect(page.getByRole("link", { name: en.ob_report_link })).toHaveAttribute("href", "/report");
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});
