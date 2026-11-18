import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { panelReleases } from "../../integrations/changelog-releases";
import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { whatsNew } from "../../src/lib/whats-new";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signIn } from "../helpers";
import { e2eEnv, repoRoot } from "../env";
import { readSeed } from "../seed";

// The Help link and the "What is new" card of the real panel follow the flag `docs_links`.
// The flag is on for the seed organization only while a test of this file turns it on; the e2e seed never holds it (stage 11 needs the
// main organization with no flag on). The built panel holds the real `CHANGELOG.md`: the spec computes the expected card from it, so a
// later release with "For users" lines does not break it.
// Blocks 40 and 140 (`nextAddress`); the file runs one test at a time.

const DOCS = "https://artexs.github.io/email_assistant/";

// The CLI of the platform (`bun run org:flag`), with the e2e env: no psql in the spec, and the same code path as an operator.
function setFlag(enabled: boolean): void {
  const { orgId } = readSeed();
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", "docs_links", enabled ? "--on" : "--off"],
    { cwd: repoRoot, env: e2eEnv(), stdio: "pipe" }
  );
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => setFlag(false));
test.afterAll(() => setFlag(false));

let errors: string[] = [];

test.beforeEach(async ({ context, page }, testInfo) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 40 : 140) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

// The owner keeps `users.locale` null in every test: the panel language comes from the browser (the Polish test sets the browser
// language), so `polish.spec.ts`, which runs after this file, still finds an owner with no stored language.
async function signInOwner(page: Page, texts: typeof en | typeof pl = en): Promise<void> {
  const { owner } = readSeed();
  await signIn(page, owner.email, owner.password, texts);
  await expect(page).toHaveURL(/\/onboarding$/);
}

// The link is in the sidebar on a desktop and in the menu sheet on a phone.
async function openMenuOnPhone(page: Page, project: string, menuLabel: string = en.menu_open): Promise<void> {
  if (project !== "mobile") return;
  await page.getByRole("button", { name: menuLabel }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function helpLinkOf(page: Page, project: string, name: string, menuLabel: string = en.menu_open) {
  await openMenuOnPhone(page, project, menuLabel);
  return page.getByRole("link", { name, exact: true });
}

const realCard = () => whatsNew(panelReleases(readFileSync(`${repoRoot}/CHANGELOG.md`, "utf8")), null);

test("T5 flag off: no Help link and no card", async ({ page }, testInfo) => {
  await signInOwner(page);
  await page.goto("/settings");
  await expect(page.getByText(en.acct_title, { exact: true })).toBeVisible();
  expect(await page.getByRole("link", { name: en.help_link }).count()).toBe(0);
  await openMenuOnPhone(page, testInfo.project.name);
  expect(await page.getByRole("link", { name: en.help_link }).count()).toBe(0);
  expect(await page.getByText(en.whats_new_title, { exact: true }).count()).toBe(0);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ea.whatsNewSeen")))
  ).toEqual([]);
});

test("T6 flag on: the Help link goes to the docs of the panel language, in a new tab", async ({ page }, testInfo) => {
  setFlag(true);
  await signInOwner(page);
  await page.goto("/settings");
  const link = await helpLinkOf(page, testInfo.project.name, en.help_link);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", DOCS);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test.describe("Polish browser", () => {
  test.use({ locale: "pl-PL" });

  test("T6 flag on, Polish panel: the Help link goes to the Polish docs", async ({ page }, testInfo) => {
    setFlag(true);
    await signInOwner(page, pl);
    await page.goto("/settings");
    const link = await helpLinkOf(page, testInfo.project.name, pl.help_link, pl.menu_open);
    await expect(link).toHaveAttribute("href", `${DOCS}pl/`);
  });
});

test("T7 flag on, empty storage: the card state equals whatsNew(real changelog, null); Close hides it for good", async ({
  page,
}) => {
  setFlag(true);
  await signInOwner(page);
  await page.goto("/settings");
  await expect(page.getByText(en.acct_title, { exact: true })).toBeVisible();
  const { show, newest } = realCard();
  const title = page.getByRole("heading", { name: en.whats_new_title, exact: true });
  if (show.length === 0) {
    await expect(title).toHaveCount(0);
    return;
  }
  await expect(title).toBeVisible();
  for (const release of show) for (const item of release.forUsers) await expect(page.getByText(item.en)).toBeVisible();
  await expect(page.getByRole("link", { name: en.whats_new_all })).toHaveAttribute("href", `${DOCS}changelog/`);
  await expectNoA11yViolations(page);

  // Keyboard reachable: focus the button and press Enter.
  const close = page.getByRole("button", { name: en.whats_new_dismiss });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(title).toHaveCount(0);
  const { user } = await (await page.request.get("/api/me")).json();
  expect(await page.evaluate((id) => localStorage.getItem(`ea.whatsNewSeen:${id}`), user.id)).toBe(newest);

  await page.reload();
  await expect(page.getByText(en.acct_title, { exact: true })).toBeVisible();
  await expect(title).toHaveCount(0);
  // Clean up: the next test starts with no stored version.
  await page.evaluate((id) => localStorage.removeItem(`ea.whatsNewSeen:${id}`), user.id);
});
