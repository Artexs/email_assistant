import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { t, tp } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The style card (name, signature, writing style, Preview, the style suggestion) and the reply drafts switch. The seed gives each project an
// organization with the flags `reply_drafts`, `style_from_sent` and `sent_sync` on (sent tracking is off) and two mailboxes: `box` (password) and `oauth` (a provider is set). The tests of a
// project run in this order and leave the organization as they found it (`reset`).
//
// The e2e server runs with the LLM scope off, so a real Preview answers `llm_off` (the first Preview test checks that round trip). The
// sample body comes from a faked answer of the route: the integration tests `replies-profile-preview.test.ts` and
// `replies-profile-routes.test.ts` cover the real route with a fake model client.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().replyStyleOrgs[project()];

// One client address for each sign-in: the login rate limit counts per address. Documentation range 192.0.2.0/24, away from the other specs.
let signIns = 0;
let ownerSession = false;
let errors: string[] = [];

async function startSession(
  context: BrowserContext,
  page: Page,
  who: "owner" | "member",
  mailboxId: string = org().box.id
): Promise<void> {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 110 : 215) + signIns}`,
  });
  errors = await cspErrors(page);
  await signInAs(page, org()[who]);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  ownerSession = who === "owner";
  await page.goto(`/settings?mailbox=${mailboxId}`);
  await expect(card(page)).toBeVisible();
}

const card = (page: Page) => page.locator("[data-card=reply-style]");
const nameField = (page: Page) => card(page).getByLabel(en.rs_name_label, { exact: true });
const signatureField = (page: Page) => card(page).getByLabel(en.rs_signature_label, { exact: true });
const styleField = (page: Page) => card(page).getByLabel(en.rs_style_label, { exact: true });
const replySwitch = (page: Page) => page.getByRole("switch", { name: en.switch_reply_drafts, exact: true });

// Puts the organization back: empty profiles, the switch off, no old organization text. Errors do not hide the real failure.
async function reset(page: Page): Promise<void> {
  const headers = { origin: E2E_BASE_URL };
  try {
    for (const mailbox of [org().box, org().oauth]) {
      await page.request.put(`/api/mailboxes/${mailbox.id}/profile`, {
        headers,
        data: { displayName: "", signature: "", writingStyle: "" },
      });
      await page.request.patch(`/api/settings/${mailbox.id}/switches/reply_drafts`, {
        headers,
        data: { value: false },
      });
      await page.request.patch(`/api/settings/${mailbox.id}/sent-sync`, { headers, data: { enabled: false } });
    }
  } catch {
    // Ignored on purpose.
  }
}

test.afterEach(async ({ page }) => {
  if (ownerSession) await reset(page);
  ownerSession = false;
  expect(errors).toEqual([]);
});

test("T1: the owner saves a name and a signature and sees them after a reload; an empty field shows the text in use", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  // No profile yet: the name in use, and the signature in use, are the name of the owner of the organization (no old org text yet).
  await expect(card(page).getByText(t("rs_in_use", { text: `E2E Reply Style owner ${project()}` }))).toHaveCount(2);
  await expect(card(page).getByRole("button", { name: en.save })).toBeDisabled();

  await nameField(page).fill("Anna Nowak");
  await signatureField(page).fill("Pozdrawiam,\nAnna");
  await expect(card(page).getByText(t("sig_counter", { count: 16, max: 1000 }))).toBeVisible();
  await card(page).getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.rs_saved_toast)).toBeVisible();
  // The text in use is hidden once the field holds a text.
  await expect(card(page).getByText(/^In use:/)).toHaveCount(0);

  await page.reload();
  await expect(nameField(page)).toHaveValue("Anna Nowak");
  await expect(signatureField(page)).toHaveValue("Pozdrawiam,\nAnna");
});

test("T1b: a name with a character that a header cannot hold is refused with a text under the field", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  await nameField(page).fill("Anna <anna@x.test>");
  await card(page).getByRole("button", { name: en.save }).click();
  await expect(card(page).getByRole("alert")).toHaveText(en.rs_err_bad_character);
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await nameField(page).fill("Anna");
  await expect(card(page).getByRole("alert")).toHaveCount(0);
});

test("T3: a member sees the card and the switch and cannot change them", async ({ context, page }) => {
  // The owner sets a name and turns the switch on through the API, so the member has something to read.
  await startSession(context, page, "owner");
  const headers = { origin: E2E_BASE_URL };
  const saved = await page.request.put(`/api/mailboxes/${org().box.id}/profile`, {
    headers,
    data: { displayName: "Anna Nowak" },
  });
  expect(saved.ok()).toBe(true);
  const turned = await page.request.patch(`/api/settings/${org().box.id}/switches/reply_drafts`, {
    headers,
    data: { value: true },
  });
  expect(turned.ok()).toBe(true);

  await context.clearCookies();
  await startSession(context, page, "member");
  await expect(nameField(page)).toHaveValue("Anna Nowak");
  await expect(nameField(page)).not.toBeEditable();
  await expect(signatureField(page)).not.toBeEditable();
  await expect(styleField(page)).not.toBeEditable();
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await expect(card(page).getByRole("combobox")).toHaveCount(0);
  await expect(replySwitch(page)).toBeDisabled();
  await expect(replySwitch(page)).toBeChecked();
  // A member who tries the write anyway gets 403.
  const write = await page.request.put(`/api/mailboxes/${org().box.id}/profile`, {
    headers,
    data: { displayName: "X" },
  });
  expect(write.status()).toBe(403);

  // The owner signs in again, so that the reset can run.
  await context.clearCookies();
  await startSession(context, page, "owner");
});

test("T4: the switch shows with the help line, turns on and off; an OAuth mailbox shows it disabled", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  const mode = page.locator("[data-card=mode]");
  await expect(mode.getByText(en.rs_switch_help)).toBeVisible();
  await expect(mode.getByText(en.rs_switch_oauth)).toHaveCount(0);
  await expect(replySwitch(page)).not.toBeChecked();
  await replySwitch(page).click();
  await expect(page.getByText(t("switch_on_toast", { name: en.switch_reply_drafts }))).toBeVisible();
  await expect(replySwitch(page)).toBeChecked();
  await page.reload();
  await expect(replySwitch(page)).toBeChecked();
  await replySwitch(page).click();
  await expect(page.getByText(t("switch_off_toast", { name: en.switch_reply_drafts }))).toBeVisible();
  await expect(replySwitch(page)).not.toBeChecked();

  await page.goto(`/settings?mailbox=${org().oauth.id}`);
  await expect(card(page)).toBeVisible();
  await expect(replySwitch(page)).toBeDisabled();
  await expect(mode.getByText(en.rs_switch_oauth)).toBeVisible();
  // The style card of an OAuth mailbox stays editable.
  await expect(nameField(page)).toBeEditable();
  await nameField(page).fill("Oauth Name");
  await card(page).getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.rs_saved_toast)).toBeVisible();
});

test("T5: the form fills the writing style and nothing is saved; Preview on this server answers that the model is off", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  await card(page).getByLabel(en.rs_form_address, { exact: true }).selectOption("formal");
  await card(page).getByLabel(en.rs_form_greeting, { exact: true }).fill("Dzień dobry");
  await card(page).getByLabel(en.rs_form_sign_off, { exact: true }).fill("Pozdrawiam");
  await card(page).getByLabel(en.rs_form_length, { exact: true }).selectOption("short");
  await card(page).getByRole("button", { name: en.rs_apply }).click();
  await expect(styleField(page)).toHaveValue(
    'Address the recipient formally. Start with the greeting "Dzień dobry". End with the sign-off "Pozdrawiam". Keep replies short.'
  );
  await expect(card(page).getByRole("button", { name: en.save })).toBeEnabled();
  // The form is not saved: a reload shows an empty writing style.
  await page.reload();
  await expect(styleField(page)).toHaveValue("");

  // The real route: the e2e server has the model off.
  await card(page).getByRole("button", { name: en.rs_preview }).click();
  await expect(card(page).getByRole("alert")).toHaveText(en.rs_preview_llm_off);
});

test("T6: Preview sends the unsaved values and shows the sample as text; the button is off while the call runs", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  await nameField(page).fill("Anna Nowak");
  await styleField(page).fill("Pisz krótko.");

  const sent: unknown[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/mailboxes/*/profile/preview", async (route) => {
    sent.push(route.request().postDataJSON());
    await held;
    // Text from a model is untrusted: this body holds markup, and the card must show it as text.
    await route.fulfill({ json: { body: "Dzień dobry,\n<img src=x onerror=alert(1)>\nPozdrawiam,\nAnna Nowak" } });
  });

  const preview = card(page).getByRole("button", { name: en.rs_preview });
  await preview.click();
  await expect(preview).toBeDisabled();
  release();
  const body = card(page).locator("[data-preview-body]");
  await expect(body).toHaveText("Dzień dobry,\n<img src=x onerror=alert(1)>\nPozdrawiam,\nAnna Nowak");
  await expect(card(page).getByText(en.rs_preview_note)).toBeVisible();
  await expect(card(page).locator("img")).toHaveCount(0);
  await expect(preview).toBeEnabled();
  // The values of the card went to the route, saved or not; a field that was never filled goes as an empty text.
  expect(sent).toEqual([{ displayName: "Anna Nowak", signature: "", writingStyle: "Pisz krótko." }]);
  // Nothing was saved by the preview.
  await page.unroute("**/api/mailboxes/*/profile/preview");
  await page.reload();
  await expect(nameField(page)).toHaveValue("");
});

test("T7: the answers of a refused or failed preview have their own texts", async ({ context, page }) => {
  await startSession(context, page, "owner");
  const answers: { status: number; json: unknown; text: string }[] = [
    { status: 429, json: { error: "preview_limit" }, text: en.rs_preview_limit },
    { status: 429, json: { error: "preview_busy" }, text: en.rs_preview_busy },
    { status: 200, json: { kind: "failed", reason: "llm_cap" }, text: en.rs_preview_cap },
    { status: 200, json: { kind: "failed", reason: "checks" }, text: en.rs_preview_failed },
  ];
  for (const answer of answers) {
    await page.route("**/api/mailboxes/*/profile/preview", (route) =>
      route.fulfill({ status: answer.status, json: answer.json })
    );
    await card(page).getByRole("button", { name: en.rs_preview }).click();
    await expect(card(page).getByRole("alert")).toHaveText(answer.text);
    await page.unroute("**/api/mailboxes/*/profile/preview");
  }
});

test("T8: the card passes axe and the keyboard reaches every field and button in order", async ({ context, page }) => {
  await startSession(context, page, "owner");
  await page.route("**/api/mailboxes/*/profile/preview", (route) =>
    route.fulfill({ json: { body: "Dzień dobry,\nPozdrawiam,\nAnna" } })
  );
  await nameField(page).fill("Anna Nowak");
  await card(page).getByRole("button", { name: en.rs_preview }).click();
  await expect(card(page).getByText(en.rs_preview_note)).toBeVisible();
  await expectNoA11yViolations(page, { schemes: ["light", "dark"] });

  // From the name field, Tab visits each control once, in the order of the page.
  await nameField(page).focus();
  const names: string[] = [];
  for (let step = 0; step < 10; step += 1) {
    names.push(
      await page.evaluate(() => {
        const element = document.activeElement as (HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }) | null;
        return (element?.labels?.[0]?.textContent ?? element?.textContent ?? "").trim();
      })
    );
    await page.keyboard.press("Tab");
  }
  expect(names).toEqual([
    en.rs_name_label,
    en.rs_signature_label,
    en.rs_form_address,
    en.rs_form_greeting,
    en.rs_form_sign_off,
    en.rs_form_length,
    en.rs_apply,
    en.rs_style_label,
    en.save,
    en.rs_preview,
  ]);
});

const SAMPLE_IDS = [
  "0190f5a0-0000-7000-8000-0000000000a1",
  "0190f5a0-0000-7000-8000-0000000000a2",
  "0190f5a0-0000-7000-8000-0000000000a3",
];
const SAMPLE_BODIES = [
  "Dzień dobry,\nTak, wtorek pasuje.",
  "Dzień dobry,\nTak, środa pasuje.",
  "<b>Dzień dobry,</b>\nTak.",
];
const samples = (state: "pending" | "done") => ({
  items: SAMPLE_IDS.map((requestId, index) => ({
    requestId,
    status: state,
    reasonCode: null,
    subject: `Temat ${index + 1}`,
    body: state === "done" ? (SAMPLE_BODIES[index] ?? null) : null,
  })),
});

test("T9: Show 3 sample drafts shows three sample texts as text; the button is off while they are written and after", async ({
  context,
  page,
}) => {
  // The e2e server has the model off, so the answers of both sample routes are faked here; the integration test
  // `web-reply-samples.test.ts` runs the real routes and the drafter job with a fake model.
  let reads = 0;
  let asked = 0;
  await page.route("**/api/mailboxes/*/reply-samples", async (route) => {
    if (route.request().method() === "POST") {
      asked += 1;
      await route.fulfill({ status: 202, json: { requestIds: SAMPLE_IDS, count: 3 } });
      return;
    }
    reads += 1;
    // No run yet at the load of the card; the first poll after the tap sees the requests waiting, the second sees them done.
    await route.fulfill({ json: reads === 1 ? { items: [] } : samples(reads === 2 ? "pending" : "done") });
  });
  await startSession(context, page, "owner");
  const button = card(page).getByRole("button", { name: en.rs_samples, exact: true });
  await expect(button).toBeEnabled();
  await expect(card(page).getByText(en.rs_samples_note).first()).toBeVisible();

  await button.click();
  await expect(button).toBeDisabled();
  await expect(card(page).getByText(en.rs_samples_waiting)).toBeVisible();
  const bodies = card(page).locator("[data-sample-body]");
  await expect(bodies).toHaveCount(3, { timeout: 15_000 });
  expect(await bodies.allTextContents()).toEqual(SAMPLE_BODIES);
  await expect(card(page).getByText(t("rs_samples_mail", { subject: "Temat 2" }))).toBeVisible();
  // A model text is untrusted: markup in it shows as text.
  await expect(card(page).locator("[data-sample] b")).toHaveCount(0);
  await expect(button).toBeDisabled();
  expect(asked).toBe(1);
  await expectNoA11yViolations(page);

  // Today's run stays: a reload shows the texts again and does not ask for a new run.
  await page.reload();
  await expect(card(page).locator("[data-sample-body]")).toHaveCount(3);
  await expect(card(page).getByRole("button", { name: en.rs_samples, exact: true })).toBeDisabled();
  expect(asked).toBe(1);
});

test("T10: the answers of a refused run have their own texts, the real route answers llm_off, and an OAuth mailbox gets the reason", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  const button = card(page).getByRole("button", { name: en.rs_samples, exact: true });
  // The real route: the e2e server has the model off.
  await button.click();
  await expect(card(page).getByRole("alert")).toHaveText(en.rs_samples_llm_off);

  // A refusal or an empty run: `alert` for a failure, a plain note (role status, no alert) for the day limit and for no mail.
  const answers: { status: number; json: unknown; text: string; role: "alert" | "status" }[] = [
    { status: 409, json: { error: "sample_limit" }, text: en.rs_samples_limit, role: "status" },
    { status: 409, json: { error: "blocked", reason: "oauth_mailbox" }, text: en.rs_samples_oauth, role: "alert" },
    { status: 202, json: { requestIds: [], count: 0 }, text: en.rs_samples_none, role: "status" },
  ];
  for (const answer of answers) {
    await page.route("**/api/mailboxes/*/reply-samples", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: answer.status, json: answer.json })
        : route.fallback()
    );
    await button.click();
    const shown = card(page).locator("[data-samples]").getByRole(answer.role);
    await expect(shown).toHaveText(answer.text);
    if (answer.role === "status") await expect(card(page).locator("[data-samples]").getByRole("alert")).toHaveCount(0);
    // The button stays on after a refusal or an empty run.
    await expect(button).toBeEnabled();
    await page.unroute("**/api/mailboxes/*/reply-samples");
  }

  // A mailbox with a provider: the reason, no button.
  await page.goto(`/settings?mailbox=${org().oauth.id}`);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText(en.rs_samples_oauth)).toBeVisible();
  await expect(card(page).getByRole("button", { name: en.rs_samples, exact: true })).toHaveCount(0);
});

test("T11: a 409 sample_limit shows the run of the day that exists (an earlier visit or another tab) instead of the refusal", async ({
  context,
  page,
}) => {
  let reads = 0;
  await page.route("**/api/mailboxes/*/reply-samples", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 409, json: { error: "sample_limit" } });
      return;
    }
    reads += 1;
    // Empty at the load of the card (the run is made by another tab after it), the run after the refusal.
    await route.fulfill({ json: reads === 1 ? { items: [] } : samples("done") });
  });
  await startSession(context, page, "owner");
  await card(page).getByRole("button", { name: en.rs_samples, exact: true }).click();
  await expect(card(page).locator("[data-sample-body]")).toHaveCount(3);
  await expect(card(page).getByText(en.rs_samples_limit)).toHaveCount(0);
});

test("T12: a run that is not over after one minute says so, keeps the button off and shows no error", async ({
  context,
  page,
}) => {
  let reads = 0;
  await page.route("**/api/mailboxes/*/reply-samples", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 202, json: { requestIds: SAMPLE_IDS, count: 3 } });
      return;
    }
    reads += 1;
    await route.fulfill({ json: reads === 1 ? { items: [] } : samples("pending") });
  });
  await startSession(context, page, "owner");
  const button = card(page).getByRole("button", { name: en.rs_samples, exact: true });
  // The page clock runs from here: the poll of one minute passes in a moment.
  await page.clock.install();
  await button.click();
  await expect(card(page).getByText(en.rs_samples_waiting)).toBeVisible();
  for (let step = 0; step < 40; step += 1) {
    await page.clock.runFor(2000);
    if ((await card(page).locator("[data-samples=slow]").count()) > 0) break;
  }
  await expect(card(page).locator("[data-samples=slow]")).toHaveText(en.rs_samples_slow);
  await expect(card(page).getByRole("alert")).toHaveCount(0);
  await expect(button).toBeDisabled();
});

const sentSyncOn = (page: Page) =>
  page.request.patch(`/api/settings/${org().box.id}/sent-sync`, {
    headers: { origin: E2E_BASE_URL },
    data: { enabled: true },
  });
const suggestButton = (page: Page) => card(page).getByRole("button", { name: en.rs_suggest_button, exact: true });

test("T13: with sent tracking off the owner reads why and sees no button; an OAuth mailbox gets the reason; a member sees nothing", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  await expect(card(page).getByText(en.rs_suggest_sent_off)).toBeVisible();
  await expect(suggestButton(page)).toHaveCount(0);
  await page.goto(`/settings?mailbox=${org().oauth.id}`);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText(en.rs_switch_oauth).first()).toBeVisible();
  await expect(suggestButton(page)).toHaveCount(0);

  await context.clearCookies();
  await startSession(context, page, "member");
  await expect(card(page).getByText(en.rs_suggest_sent_off)).toHaveCount(0);
  await expect(suggestButton(page)).toHaveCount(0);
});

test("T14: the owner asks for a suggestion, uses the text and saves; nothing is saved before Save", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  expect((await sentSyncOn(page)).ok()).toBe(true);
  await page.reload();
  await expect(card(page)).toBeVisible();

  const asked: string[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/mailboxes/*/profile/style-suggestion", async (route) => {
    asked.push(route.request().method());
    await held;
    await route.fulfill({ json: { text: "Pisz krótko i uprzejmie. <b>Bez</b> ozdobników.", count: 7 } });
  });
  await styleField(page).fill("Stary styl.");
  await suggestButton(page).click();
  await expect(suggestButton(page)).toBeDisabled();
  release();

  const box = card(page).locator("[data-suggest-text]");
  await expect(box).toHaveText("Pisz krótko i uprzejmie. <b>Bez</b> ozdobników.");
  await expect(card(page).getByText(tp("rs_suggest_result", 7))).toBeVisible();
  await expect(card(page).locator("[data-suggest-text] b")).toHaveCount(0);
  // The box is not the field: the old text stays until "Use this text".
  await expect(styleField(page)).toHaveValue("Stary styl.");
  await expectNoA11yViolations(page, { schemes: ["light", "dark"] });

  await card(page).getByRole("button", { name: en.rs_suggest_use, exact: true }).click();
  await expect(styleField(page)).toHaveValue("Pisz krótko i uprzejmie. <b>Bez</b> ozdobników.");
  await expect(styleField(page)).toBeFocused();
  await expect(box).toHaveCount(0);
  expect(asked).toEqual(["POST"]);

  // Nothing is saved before Save: a reload shows an empty writing style; the same steps and Save keep the text.
  await page.unroute("**/api/mailboxes/*/profile/style-suggestion");
  await page.reload();
  await expect(styleField(page)).toHaveValue("");
  await page.route("**/api/mailboxes/*/profile/style-suggestion", (route) =>
    route.fulfill({ json: { text: "Pisz krótko.", count: 7 } })
  );
  await suggestButton(page).click();
  await card(page).getByRole("button", { name: en.rs_suggest_use, exact: true }).click();
  await card(page).getByRole("button", { name: en.save, exact: true }).click();
  await expect(page.getByText(en.rs_saved_toast)).toBeVisible();
  await page.reload();
  await expect(styleField(page)).toHaveValue("Pisz krótko.");
});

test("T15: a discarded suggestion closes the box and leaves the field; the refusals have their own lines", async ({
  context,
  page,
}) => {
  await startSession(context, page, "owner");
  expect((await sentSyncOn(page)).ok()).toBe(true);
  await page.reload();
  await expect(card(page)).toBeVisible();
  await styleField(page).fill("Mój styl.");

  await page.route("**/api/mailboxes/*/profile/style-suggestion", (route) =>
    route.fulfill({ json: { text: "Inny styl.", count: 5 } })
  );
  await suggestButton(page).click();
  await expect(card(page).locator("[data-suggest-text]")).toHaveText("Inny styl.");
  await card(page).getByRole("button", { name: en.rs_suggest_discard, exact: true }).click();
  await expect(card(page).locator("[data-suggest-text]")).toHaveCount(0);
  await expect(styleField(page)).toHaveValue("Mój styl.");
  await page.unroute("**/api/mailboxes/*/profile/style-suggestion");

  const answers = [
    { status: 409, json: { error: "too_few", count: 3 }, text: t("rs_suggest_too_few", { count: 3 }) },
    { status: 409, json: { error: "sent_off" }, text: en.rs_suggest_sent_off },
    { status: 429, json: { error: "suggest_limit" }, text: en.rs_suggest_limit },
    { status: 429, json: { error: "suggest_busy" }, text: en.rs_suggest_busy },
    { status: 200, json: { kind: "failed", reason: "llm_cap" }, text: en.rs_preview_cap },
    { status: 200, json: { kind: "failed", reason: "checks" }, text: en.rs_suggest_failed },
  ];
  for (const answer of answers) {
    await page.route("**/api/mailboxes/*/profile/style-suggestion", (route) =>
      route.fulfill({ status: answer.status, json: answer.json })
    );
    await suggestButton(page).click();
    await expect(card(page).locator("[data-suggest=shown]")).toHaveText(answer.text);
    await expect(card(page).locator("[data-suggest-text]")).toHaveCount(0);
    await page.unroute("**/api/mailboxes/*/profile/style-suggestion");
  }
  // The real route on this server: the model is off, so the answer is a refusal with its own text, never a suggestion.
  await suggestButton(page).click();
  await expect(card(page).locator("[data-suggest=shown]")).toHaveText(en.rs_preview_llm_off);
  await expect(card(page).locator("[data-suggest-text]")).toHaveCount(0);
});

test("T16: at 320 px the card fits the screen with the guided form, the buttons and the Preview answer", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await startSession(context, page, "owner");
  await page.route("**/api/mailboxes/*/profile/preview", (route) =>
    route.fulfill({ json: { body: "Dzień dobry,\n<b>Hi</b>\nPozdrawiam,\nAnna" } })
  );
  await card(page).getByRole("button", { name: en.rs_preview }).click();
  await expect(card(page).locator("[data-preview-body]")).toHaveText("Dzień dobry,\n<b>Hi</b>\nPozdrawiam,\nAnna");
  await expect(card(page).locator("b")).toHaveCount(0);
  await expect(card(page).getByLabel(en.rs_form_greeting, { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoA11yViolations(page, { schemes: ["light", "dark"] });
});
