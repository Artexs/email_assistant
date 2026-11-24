import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cleanUpOrg, cspErrors, nextAddress, signIn } from "../helpers";
import { e2eEnv, repoRoot } from "../env";
import { readSeed } from "../seed";

// The sign-in buttons of the connect dialog and the result banner on `/mailboxes`, in a browser.
// The fake Microsoft client keys are in `e2e/env.ts`. The flag `mail_oauth_microsoft` is on for the seed organization only while this
// file runs; Google stays off.
// The browser never reaches Microsoft: the spec answers the authorize URL itself.

const CARD = '[data-slot="card"][data-state]';
const AUTHORIZE = "https://login.microsoftonline.com/**";

// The CLI of the platform (`bun run org:flag`), with the e2e env: no psql in the spec, and the same code path as an operator.
function setFlag(flag: string, enabled: boolean): void {
  const { orgId } = readSeed();
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", flag, enabled ? "--on" : "--off"],
    {
      cwd: repoRoot,
      env: e2eEnv(),
      stdio: "pipe",
    }
  );
}

let errors: string[] = [];

test.beforeAll(() => setFlag("mail_oauth_microsoft", true));
test.afterAll(() => setFlag("mail_oauth_microsoft", false));

test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 60 : 160;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  const { owner } = readSeed();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

async function openDialog(page: Page) {
  await page.goto("/mailboxes");
  await expect(page.getByText(en.mb_empty)).toBeVisible();
  await page.getByRole("button", { name: en.mb_connect }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: en.oauth_btn_microsoft })).toBeVisible();
  return dialog;
}

test("the dialog shows only the enabled provider, is axe clean, and a keyboard tap goes to the provider", async ({
  page,
}) => {
  const starts: { body: string | null; contentType: string | undefined }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/mailboxes/oauth/microsoft/start")) {
      starts.push({ body: request.postData(), contentType: request.headers()["content-type"] });
    }
  });
  await page.route(AUTHORIZE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>provider</title><p>provider</p>",
    })
  );

  const dialog = await openDialog(page);
  await expect(dialog.getByRole("button", { name: en.oauth_btn_google })).toHaveCount(0);
  await expect(dialog.getByText(en.oauth_or_password)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: en.provider_label })).toBeVisible();
  await expectNoA11yViolations(page, { include: "[role=dialog]" });

  // Keyboard only: focus the button, then Enter.
  const button = dialog.getByRole("button", { name: en.oauth_btn_microsoft });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");

  await page.waitForURL(/^https:\/\/login\.microsoftonline\.com\//, { timeout: 10_000 }).catch(() => undefined);
  const shown = await dialog
    .getByRole("alert")
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  // On failure this names the start request and the text the dialog showed.
  expect({ url: page.url().split("?")[0], starts, shown }).toEqual({
    url: expect.stringMatching(/^https:\/\/login\.microsoftonline\.com\//),
    starts: [expect.objectContaining({})],
    shown: null,
  });
  const query = new URL(page.url()).searchParams;
  expect(query.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(query.get("code_challenge_method")).toBe("S256");
  // Nothing of the sign-in stays in the cookies or the local storage of the browser.
  const stored = JSON.stringify(await page.context().storageState());
  expect(stored).not.toContain(query.get("state") ?? "-");
});

test("a crafted ?oauth= value shows the failed text as an alert, never the value, and leaves the address", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/mailboxes");
  const before = await page.evaluate(() => history.length);
  const crafted = encodeURIComponent("<img src=x onerror=alert(1)><script>alert(2)</script>");
  await page.goto(`/mailboxes?oauth=${crafted}&mailbox=x&provider=microsoft&keep=1`);
  const banner = page.locator("[data-block=oauth-banner]");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toContainText(en.oauth_err_failed);
  expect(await banner.innerHTML()).not.toContain("onerror");
  await expect(page).toHaveURL(/\/mailboxes\?keep=1$/);
  // goto adds one entry; replaceState adds none.
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  await expectNoA11yViolations(page);
  expect(dialogs).toEqual([]);

  // Close with the keyboard.
  await banner.getByRole("button", { name: en.close }).focus();
  await page.keyboard.press("Enter");
  await expect(banner).toHaveCount(0);

  await page.goto("/mailboxes?oauth=connected&mailbox=0190f5a0-0000-7000-8000-000000000003");
  const ok = page.locator("[data-block=oauth-banner]");
  await expect(ok).toHaveAttribute("role", "status");
  await expect(ok).toContainText(en.oauth_ok_connected);
  await expect(page).toHaveURL(/\/mailboxes$/);
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(page.locator("[data-block=oauth-banner]")).toHaveCount(0);
});

test("a restored page (bfcache) enables the buttons again after a tap that left for the provider", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/mailboxes/oauth/microsoft/start", async (route) => {
    await gate;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal" }) });
  });
  const dialog = await openDialog(page);
  const button = dialog.getByRole("button", { name: en.oauth_btn_microsoft });
  await button.click();
  await expect(button).toBeDisabled();
  const fire = (persisted: boolean) =>
    page.evaluate(
      (value) => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: value })),
      persisted
    );
  await fire(false);
  await expect(button).toBeDisabled();
  await fire(true);
  await expect(button).toBeEnabled();
  release();
});

test("Reconnect on a card with withdrawn access starts the sign-in for that mailbox", async ({ page }) => {
  const mailboxId = "6f1d0b3c-8a2e-4f7a-9d55-3b1c2a4e5f60";
  const bodies: unknown[] = [];
  await page.route("**/api/mailboxes", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const scope = { state: "on", reason: "all_mailboxes" };
    await route.fulfill({
      json: [
        {
          id: mailboxId,
          address: "anna@example.com",
          status: "auth_error",
          statusChangedAt: "2026-11-20T08:00:00.000Z",
          createdAt: "2026-11-20T08:00:00.000Z",
          lastSyncedAt: "2026-11-20T08:00:00.000Z",
          mode: "shadow",
          movesSupported: true,
          secretKind: "password",
          authMethod: "oauth",
          oauthProvider: "microsoft",
          authReason: "oauth_revoked",
          scopes: { triage: scope, actions: scope, send: scope },
        },
      ],
    });
  });
  await page.route("**/api/mailboxes/oauth/microsoft/start", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "https://login.microsoftonline.com/authorize?state=x" } });
  });
  await page.route(AUTHORIZE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>provider</title><p>provider</p>",
    })
  );

  await page.goto("/mailboxes");
  const card = page.locator(`${CARD}[data-state="access_revoked"]`);
  await expect(card.getByRole("button", { name: en.mb_change_password })).toHaveCount(0);
  await expectNoA11yViolations(page);
  await card.getByRole("button", { name: en.mb_reconnect }).click();
  await page.waitForURL(/^https:\/\/login\.microsoftonline\.com\//);
  expect(bodies).toEqual([{ mailboxId }]);
});
