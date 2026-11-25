import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_NEWSLETTER_LINK, E2E_NEWSLETTER_SENDERS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The newsletters organization of the project (see `e2e-seed.ts`): the flag `bulk_unsubscribe` is on; one mailbox with five senders
// (`E2E_NEWSLETTER_SENDERS`). The server trusts the authserv-id of the seeded `dkim=pass`, so the `oneClick` sender is one-click.
const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().newsletterOrgs[project()];

// Every test signs in once, from its own client address (the login rate limit counts per address). Documentation range 192.0.2.0/24.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 30 : 160) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const card = (page: Page) => page.locator("[data-card=newsletters]");
const row = (page: Page, address: string): Locator => card(page).locator(`[data-sender="${address}"]`);
const S = E2E_NEWSLETTER_SENDERS;

async function openCard(page: Page): Promise<void> {
  await page.goto("/rules");
  await expect(card(page)).toBeVisible();
  await expect(row(page, S.oneClick.address)).toBeVisible();
}

test("T1: the owner sees one row per sender with the method, the count and the one action of the method", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expect(card(page).locator("[data-sender]")).toHaveCount(5);

  // One-click: no link; the owner gets the button, named by the address. The test never taps it: a tap makes the server resolve
  // the host of the seeded link (the tap is tested with a fake client in `web-newsletters-unsubscribe.test.ts`).
  const one = row(page, S.oneClick.address);
  await expect(one).toHaveAttribute("data-method", "one_click");
  await expect(one).toContainText("3 mails in 30 days");
  await expect(one.getByRole("link")).toHaveCount(0);
  await expect(one.getByRole("button", { name: `Unsubscribe from ${S.oneClick.address}` })).toBeVisible();
  await expect(card(page).getByRole("button", { name: /^Unsubscribe from / })).toHaveCount(1);

  // Link only: the page opens in a new tab, and the server does nothing.
  const link = row(page, S.link.address);
  await expect(link).toHaveAttribute("data-method", "link");
  await expect(link).toContainText("2 mails in 30 days");
  const anchor = link.getByRole("link", { name: `Open unsubscribe page for ${S.link.address} (new tab)` });
  await expect(anchor).toHaveText(en.nl_open_link);
  await expect(anchor).toHaveAttribute("href", E2E_NEWSLETTER_LINK);
  await expect(anchor).toHaveAttribute("target", "_blank");
  await expect(anchor).toHaveAttribute("rel", /noopener/);
  await expect(anchor).toHaveAttribute("rel", /noreferrer/);

  // No link.
  const none = row(page, S.none.address);
  await expect(none).toHaveAttribute("data-method", "none");
  await expect(none).toContainText("1 mail in 30 days");
  await expect(none).toContainText(en.nl_none);
  await expect(none.getByRole("link")).toHaveCount(0);

  // A failed request: the state, and the page as the way out.
  const failed = row(page, S.failed.address);
  await expect(failed).toContainText(en.nl_failed_open);
  await expect(failed.getByRole("link", { name: /Open unsubscribe page/ })).toHaveAttribute(
    "href",
    E2E_NEWSLETTER_LINK
  );

  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T2: the display name of a sender is plain text: markup in it makes no element, and the address stays the identity", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  const markup = row(page, S.markup.address);
  await expect(markup).toContainText(S.markup.name);
  await expect(markup.locator("img")).toHaveCount(0);
  await expect(markup.locator("[data-slot=row] p").first()).toHaveText(S.markup.address);
  expect(errors).toEqual([]);
});

test("T3: a member sees the list and no link and no button, and the page sends no request but the list", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().member);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/newsletters") && request.method() !== "GET") {
      writes.push(request.method());
    }
  });
  await openCard(page);
  await expect(card(page).locator("[data-sender]")).toHaveCount(5);
  await expect(card(page).getByRole("link")).toHaveCount(0);
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await expect(row(page, S.none.address)).toContainText(en.nl_none);
  await expect(row(page, S.failed.address)).toContainText(en.nl_failed);
  await expect(row(page, S.failed.address)).not.toContainText(en.nl_failed_open);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("T4: with the flag off the Rules page has no newsletters card and asks for no list", async ({ context, page }) => {
  // The paused organization: one mailbox and no flag `bulk_unsubscribe`.
  const errors = await startSession(context, page, readSeed().pausedOwner);
  const listRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/newsletters/")) listRequests.push(request.url());
  });
  await page.goto("/rules");
  await expect(page.locator("[data-kind=vip]")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(en.nl_title, { exact: true })).toHaveCount(0);
  expect(listRequests).toEqual([]);
  expect(errors).toEqual([]);
});
