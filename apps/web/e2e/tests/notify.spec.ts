import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv, E2E_BASE_URL, repoRoot } from "../env";
import { cleanUpOrg, cspErrors, nextAddress, signInAs } from "../helpers";
import { saveCardPictures } from "../lib/card-pictures";
import { readSeed } from "../seed";

// The quiet hours card of Settings. The flag `user_quiet_hours` is on for the seed organization only while this file
// runs. The channel card needs the flag `report_mail`: it stays off here, so the card must not show.
test.describe.configure({ mode: "serial" });

// The CLI of the platform (`bun run org:flag`), with the e2e env: the same code path as an operator.
function setFlag(flag: string, enabled: boolean): void {
  const { orgId } = readSeed();
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", flag, enabled ? "--on" : "--off"],
    { cwd: repoRoot, env: e2eEnv(), stdio: "pipe" }
  );
}

let errors: string[] = [];

test.beforeAll(() => setFlag("user_quiet_hours", true));
test.afterAll(() => setFlag("user_quiet_hours", false));

test.beforeEach(async ({ context, page }, testInfo) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 35 : 135) });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  // Back to the default hours: both null.
  await page.request.patch("/api/me/notify", {
    headers: { origin: E2E_BASE_URL },
    data: { quietStart: null, quietEnd: null },
  });
  expect(errors).toEqual([]);
});

test("10. the card saves quiet hours, shows them after a reload, and is axe clean; the channel card stays hidden", async ({
  page,
}, testInfo) => {
  await page.goto("/settings");
  const card = page.locator("[data-card=quiet-hours]");
  await expect(card).toBeVisible();
  await expect(page.locator("[data-card=report-channel]")).toHaveCount(0);
  await expect(card.getByLabel(en.notify_quiet_start_label)).toHaveValue("22:00");
  await expect(card.getByText(en.notify_quiet_default_note)).toBeVisible();

  await card.getByLabel(en.notify_quiet_start_label).fill("23:00");
  await card.getByLabel(en.notify_quiet_end_label).fill("06:00");
  await card.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.notify_quiet_saved_toast)).toBeVisible();

  await page.reload();
  const again = page.locator("[data-card=quiet-hours]");
  await expect(again.getByLabel(en.notify_quiet_start_label)).toHaveValue("23:00");
  await expect(again.getByLabel(en.notify_quiet_end_label)).toHaveValue("06:00");
  await expect(again.getByText(en.notify_quiet_default_note)).toHaveCount(0);
  await expectNoA11yViolations(page, { include: "[data-card=quiet-hours]" });
  // Two unsaved digest times show the pills in the picture (the seed user may hold times of an earlier spec: clear them first).
  const digest = page.locator("[data-card=digest]");
  const removes = digest.getByRole("button", { name: /^Remove/ });
  for (let left = await removes.count(); left > 0; left -= 1) await removes.first().click();
  for (const [index, time] of ["08:00", "18:00"].entries()) {
    await digest.getByRole("button", { name: en.digest_add }).click();
    await digest.getByLabel(t("digest_time_label", { n: index + 1 }), { exact: true }).fill(time);
  }
  await expect(digest.getByRole("button", { name: t("digest_remove", { time: "18:00" }) })).toBeVisible();
  await saveCardPictures(page, testInfo, "f170-04", {
    "quiet-hours": again,
    digest,
  });

  // The reset button brings the default hours back.
  await again.getByRole("button", { name: en.notify_quiet_use_default }).click();
  await expect(again.getByText(en.notify_quiet_default_note)).toBeVisible();
  await expect(again.getByLabel(en.notify_quiet_start_label)).toHaveValue("22:00");
});
