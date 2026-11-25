import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { E2E_REPLY_PANEL } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { MINUTE_MS } from "@ea/core";

// The reply kind on the approvals page and the Draft reply button of the activity rows. The seed gives each project an organization with
// five waiting reply drafts and two mails with no draft (`e2e-reply-panel-rows.ts`). The model is off in the e2e server, so the two routes
// that need a drafter (`POST /api/approvals/:id/redraft`, `POST /api/replies`) and the status route that the page polls are answered by the
// browser (`page.route`) with the answers of the real routes; the integration tests `web-reply-routes.test.ts` and `web-reply-read.test.ts`
// run the real routes and the real job with a fake model. Everything else runs for real: the read model, Reply all, Use Reply-To, the
// edit, the approve, and the blocked answer of the request route.
// The tests change the drafts, so they run in this order: the reads, the activity rows, then the edits.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().replyPanelOrgs[project()];
const P = E2E_REPLY_PANEL;

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 198.51.100.0/24,
// a block per project, away from the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, who: "owner" | "member" = "owner") {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${(project() === "mobile" ? 20 : 60) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, org()[who]);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const detailOf = (page: Page) => page.getByRole("region", { name: en.appr_detail_label });
const statusOf = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const openItem = async (page: Page, sendId: string) => {
  await page.goto(`/approvals?id=${sendId}`);
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeVisible();
};
const savedText = (n: number) => en.appr_edit_saved.replace("{n}", `${n}`);
const instructionBox = (page: Page) => detailOf(page).getByLabel(en.rp_instruction_label);
const redraftButton = (page: Page) => detailOf(page).getByRole("button", { name: en.rp_redraft, exact: true });
const activityRow = (page: Page, subject: string) => page.locator("li[data-email-id]").filter({ hasText: subject });

const REQUEST = "0190f5a0-0000-7000-8000-0000000000e1";

// The answers of the drafter, from the browser: the request is `drafting` once, then `done` with the id of the new version.
async function fakeDrafter(
  page: Page,
  newSendId: string,
  posts: { redraft: number; request: number; reads?: number },
  drafting = 1
) {
  await page.route("**/api/approvals/*/redraft", async (route) => {
    posts.redraft += 1;
    await route.fulfill({ status: 202, json: { requestId: REQUEST } });
  });
  await page.route("**/api/replies", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.request += 1;
    return route.fulfill({ status: 202, json: { requestId: REQUEST } });
  });
  let reads = 0;
  await page.route(`**/api/replies/requests/${REQUEST}`, async (route) => {
    reads += 1;
    posts.reads = reads;
    await route.fulfill({
      json:
        reads <= drafting
          ? { status: "drafting", reasonCode: null, sendId: null }
          : { status: "done", reasonCode: null, sendId: newSendId },
    });
  });
}

test("T1: a reply shows its gaps first, who it goes to, the full body and the quote closed, and a member has no button", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, "member");
  await openItem(page, org().sendIds.gap);
  const detail = detailOf(page);
  await expect(detail.getByRole("heading", { level: 3, name: en.rp_gaps_title })).toBeVisible();
  await expect(detail.getByRole("listitem").filter({ hasText: P.gap.label })).toBeVisible();
  await expect(detail).toContainText(`${en.appr_to}: ${P.gap.from}`);
  await expect(detail).toContainText("Cena to [[kwota]] zł.");
  await expect(detail).toContainText(en.rp_mode_from);
  // The Sent mail is not read (the flag `sent_sync` is off in this organization).
  await expect(detail).toContainText(en.rp_sent_hidden);
  // The quote is a closed `details`: its text is not visible until the summary is opened.
  await expect(detail.getByText(en.appr_quote)).toBeVisible();
  await expect(detail.locator("details")).not.toHaveAttribute("open", "");
  // The state line with the time left comes after the quote, as the last fact of the draft.
  await expect(detail).toContainText(en.appr_state_waiting);
  await expect(detail).toContainText("Expires in");
  // A member reads only: no action button, no instruction field.
  await expect(detail.getByText(en.owner_only)).toBeVisible();
  for (const name of [en.appr_approve, en.appr_reject, en.appr_edit, en.rp_redraft, en.rp_reply_all]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel(en.rp_instruction_label)).toHaveCount(0);
  const refused = await page.request.post(`/api/approvals/${org().sendIds.gap}/redraft`, {
    data: { instruction: "krócej" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(refused.status()).toBe(403);
  expect(errors).toEqual([]);
});

test("T2: the lists of the Reply-To addresses and the other recipients show before the tap; a lookalike domain shows as punycode with a mark", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  await openItem(page, org().sendIds.all);
  const detail = detailOf(page);
  await expect(detail).toContainText(`${en.rp_reply_to}: office@client.test, info@xn--clent-o2e.test`);
  await expect(detail.getByText(en.rp_address_unusual)).toHaveCount(1);
  await expect(detail).toContainText(`${en.rp_reply_all_adds} b@y.test, c@z.test`);
  await expect(detail).toContainText(`${en.rp_use_reply_to_to} office@client.test`);
  await expect(detail.getByRole("button", { name: en.rp_reply_all, exact: true })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(errors).toEqual([]);
});

test("T3: the page of a reply with a gap, with other recipients and a clean one have no axe violation", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  for (const id of [org().sendIds.gap, org().sendIds.all, org().sendIds.plainTwo]) {
    await openItem(page, id);
    await expect(detailOf(page).getByRole("button", { name: en.appr_approve, exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  }
  // The text of a gap: Approve is off and says why.
  await openItem(page, org().sendIds.gap);
  await expect(detailOf(page).getByRole("button", { name: en.appr_approve, exact: true })).toBeDisabled();
  await expect(detailOf(page).getByText(en.rp_approve_gaps)).toBeVisible();
  expect(errors).toEqual([]);
});

test("T4: the keyboard reaches the instruction field, Redraft and Approve in this order", async ({ context, page }) => {
  test.skip(project() === "mobile", "the keyboard path runs on the desktop project");
  const errors = await startSession(context, page);
  await openItem(page, org().sendIds.plain);
  const field = instructionBox(page);
  await field.focus();
  await expect(field).toBeFocused();
  await page.keyboard.type("krócej");
  await expect(redraftButton(page)).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(redraftButton(page)).toBeFocused();
  // A new card turns its decision buttons on after a moment; Tab skips a button that is still off.
  await expect(detailOf(page).getByRole("button", { name: en.appr_approve, exact: true })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(detailOf(page).getByRole("button", { name: en.appr_approve, exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("T5: a Draft reply on a clean mail says Drafting…, then links to the draft", async ({ context, page }) => {
  const errors = await startSession(context, page);
  const posts = { redraft: 0, request: 0 };
  await fakeDrafter(page, org().sendIds.plainTwo, posts);
  await page.goto("/activity");
  const row = activityRow(page, P.clean.subject);
  await expect(row).toBeVisible();
  const button = row.getByRole("button", { name: en.rp_draft_reply_for.replace("{subject}", P.clean.subject) });
  await button.click();
  await expect(row.getByText(en.rp_drafting)).toBeVisible();
  await expect(button).toBeDisabled();
  const link = row.getByRole("link", { name: en.rp_open_draft_for.replace("{subject}", P.clean.subject) });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute("href", `/approvals?id=${org().sendIds.plainTwo}`);
  expect(posts.request).toBe(1);
  await link.click();
  await expect(detailOf(page)).toContainText(P.plainTwo.subject);
  expect(errors).toEqual([]);
});

test("T6: a mail with an open draft links to it; a flagged mail says why there is no draft; a member sees no button", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  await page.goto("/activity");
  const open = activityRow(page, P.gap.subject).getByRole("link", {
    name: en.rp_open_draft_for.replace("{subject}", P.gap.subject),
  });
  await expect(open).toHaveAttribute("href", `/approvals?id=${org().sendIds.gap}`);
  await expect(activityRow(page, P.gap.subject).getByRole("button", { name: /^✍️ Draft reply/ })).toHaveCount(0);

  // The real route answers 409 `blocked` for a mail with a suspicious sign.
  const flagged = activityRow(page, P.flagged.subject);
  await flagged.getByRole("button", { name: en.rp_draft_reply_for.replace("{subject}", P.flagged.subject) }).click();
  await expect(flagged.getByRole("alert")).toHaveText(en.rp_blocked_suspicious);
  await expect(flagged.getByRole("link", { name: /^Open the draft/ })).toHaveCount(0);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T6b: a row that leaves the list while its draft waits stops polling", async ({ context, page }) => {
  const errors = await startSession(context, page);
  const posts = { redraft: 0, request: 0, reads: 0 };
  // The request stays `drafting` for good: only the end of the page or of the row can stop the poll.
  await fakeDrafter(page, org().sendIds.plainTwo, posts, 1_000);
  await page.goto("/activity");
  const row = activityRow(page, P.clean.subject);
  await row.getByRole("button", { name: en.rp_draft_reply_for.replace("{subject}", P.clean.subject) }).click();
  await expect(row.getByText(en.rp_drafting)).toBeVisible();
  await expect.poll(() => posts.reads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // The category filter removes the row: the component unmounts and its wait ends.
  await page.getByRole("combobox", { name: en.act_filter_category }).click();
  await page.getByRole("option", { name: en.act_cat_spam, exact: true }).click();
  await expect(row).toHaveCount(0);
  const seen = posts.reads;
  await page.waitForTimeout(5_000);
  expect(posts.reads).toBe(seen);
  expect(errors).toEqual([]);
});

test("T7: a member sees no Draft reply button on an activity row", async ({ context, page }) => {
  const errors = await startSession(context, page, "member");
  await page.goto("/activity");
  await expect(activityRow(page, P.clean.subject)).toBeVisible();
  await expect(page.getByRole("button", { name: /^✍️ Draft reply/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Open the draft/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T8: Redraft with a line shows Drafting…, keeps the button off while it waits, then shows version 2 with four redrafts left", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  const posts = { redraft: 0, request: 0 };
  await fakeDrafter(page, org().sendIds.plainTwo, posts);
  await openItem(page, org().sendIds.plain);
  // No line: Redraft is off. Five redrafts are left.
  await expect(redraftButton(page)).toBeDisabled();
  await expect(detailOf(page)).toContainText(en.rp_redraft_left.replace("{n}", "5"));
  await instructionBox(page).fill(P.plainTwo.instruction);
  await expect(detailOf(page)).toContainText(
    en.rp_instruction_count.replace("{n}", `${P.plainTwo.instruction.length}`).replace("{max}", "300")
  );
  await expect(redraftButton(page)).toBeEnabled();

  // A double click makes one request: the page keeps the button off while the request waits.
  await redraftButton(page).dblclick();
  await expect(detailOf(page).getByText(en.rp_drafting)).toBeVisible();
  await expect(redraftButton(page)).toBeDisabled();
  await expect(instructionBox(page)).toBeDisabled();
  await expect(page.getByText(en.rp_redraft_done)).toBeVisible({ timeout: 15_000 });
  expect(posts.redraft).toBe(1);

  expect(new URL(page.url()).searchParams.get("id")).toBe(org().sendIds.plainTwo);
  const detail = detailOf(page);
  await expect(detail).toContainText(en.appr_version.replace("{n}", "2"));
  await expect(detail).toContainText(P.plainTwo.body.split("\n")[2] ?? "");
  await expect(detail).toContainText(en.rp_redraft_left.replace("{n}", "4"));
  await expect(statusOf(page, en.rp_redraft_done)).toBeFocused();
  expect(errors).toEqual([]);
});

test("T8b: a page that moves to another draft while a redraft waits does not open the new version when it is done", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  const posts = { redraft: 0, request: 0 };
  // The request is `drafting` for two reads (about 4 seconds): the page has left by then.
  await fakeDrafter(page, org().sendIds.plainTwo, posts, 2);
  await openItem(page, org().sendIds.plain);
  await instructionBox(page).fill("krócej");
  await redraftButton(page).click();
  await expect(detailOf(page).getByText(en.rp_drafting)).toBeVisible();

  // Another item of the list (the phone opens the list of all waiting drafts first).
  if (project() === "mobile") {
    await page.getByRole("button", { name: en.appr_all_waiting.replace(" ({n})", "") }).click();
  }
  await page.getByRole("list", { name: en.appr_list_label }).locator(`a[href$="${org().sendIds.viaReplyTo}"]`).click();
  await expect(detailOf(page)).toContainText(P.viaReplyTo.subject);

  await page.waitForTimeout(6_000);
  expect(new URL(page.url()).searchParams.get("id")).toBe(org().sendIds.viaReplyTo);
  await expect(page.getByText(en.rp_redraft_done)).toHaveCount(0);
  await expect(detailOf(page)).toContainText(P.viaReplyTo.subject);
  expect(errors).toEqual([]);
});

test("T9: Reply all adds the other recipients to Cc as version 2; a second tap goes back to the sender as version 3", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page);
  await openItem(page, org().sendIds.all);
  const replyAll = detailOf(page).getByRole("button", { name: en.rp_reply_all, exact: true });
  await replyAll.click();
  await expect(page.getByText(savedText(2))).toBeVisible();
  const detail = detailOf(page);
  await expect(detail).toContainText(`${en.appr_cc}: b@y.test, c@z.test`);
  await expect(detail).toContainText(en.appr_version.replace("{n}", "2"));
  await expect(detail).toContainText(en.rp_mode_all);
  await expect(detail.getByRole("button", { name: en.rp_reply_all, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(statusOf(page, savedText(2))).toBeFocused();

  await detail.getByRole("button", { name: en.rp_reply_all, exact: true }).click();
  await expect(page.getByText(savedText(3))).toBeVisible();
  await expect(detailOf(page).getByText(new RegExp(`^${en.appr_cc}: `))).toHaveCount(0);
  await expect(detailOf(page).getByRole("button", { name: en.rp_reply_all, exact: true })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await expect(detailOf(page)).toContainText(en.rp_mode_from);
  expect(errors).toEqual([]);
});

test("T10: Use Reply-To sends to the Reply-To address of the mail as version 2", async ({ context, page }) => {
  const errors = await startSession(context, page);
  await openItem(page, org().sendIds.viaReplyTo);
  const detail = detailOf(page);
  await expect(detail).toContainText(`${en.rp_use_reply_to_to} billing@client.test`);
  await detail.getByRole("button", { name: en.rp_use_reply_to, exact: true }).click();
  await expect(page.getByText(savedText(2))).toBeVisible();
  await expect(detailOf(page)).toContainText(`${en.appr_to}: billing@client.test`);
  await expect(detailOf(page)).toContainText(en.rp_mode_reply_to);
  await expect(detailOf(page)).toContainText(en.appr_version.replace("{n}", "2"));
  expect(errors).toEqual([]);
});

test("T11: Edit fills the gap, version 2 has no gap and approves", async ({ context, page }) => {
  // The committer of the e2e server runs every 15 seconds and makes the mailbox copy of the new version.
  test.setTimeout(120_000);
  const errors = await startSession(context, page);
  await openItem(page, org().sendIds.gap);
  const detail = detailOf(page);
  await expect(detail.getByRole("button", { name: en.appr_approve, exact: true })).toBeDisabled();
  await detail.getByRole("button", { name: en.appr_edit, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(en.rp_edit_hint_editable);
  await expect(dialog).toContainText(en.rp_edit_gaps_hint);
  const body = dialog.getByLabel(en.appr_edit_body);
  // The form starts with the whole text of the draft (the signature of the mailbox is part of it).
  await expect(body).toHaveValue(/Cena to \[\[kwota\]\] zł\./);
  await body.fill(P.gap.filled);
  await dialog.getByRole("button", { name: en.save, exact: true }).click();
  await expect(page.getByText(savedText(2))).toBeVisible();
  await expect(detailOf(page).getByRole("heading", { level: 3, name: en.rp_gaps_title })).toHaveCount(0);
  await expect(detailOf(page)).toContainText("Cena to 120 zł.");

  // Approve turns on when the committer made the copy; SEND_SCOPE=self holds a send to this address, so the page says so.
  await expect(detailOf(page).getByRole("button", { name: en.appr_approve, exact: true })).toBeEnabled({
    timeout: MINUTE_MS,
  });
  await detailOf(page).getByRole("button", { name: en.appr_approve, exact: true }).click();
  await expect(page.getByText(en.appr_done_held.replace("{reason}", en.appr_held_scope))).toBeVisible();
  expect(errors).toEqual([]);
});
