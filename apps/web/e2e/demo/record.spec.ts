import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FAKE_TOKEN } from "../../../../tools/fake-telegram/src/state";
import { publicContentScan } from "@ea/core/web";
import { ACTIVITY_SUBJECTS, E2E_DELEGATIONS } from "../../../server/src/scripts/e2e-seed-args";
import { SHOT_TEXT_ALLOW } from "../../../docs/src/shots";
import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { E2E_BASE_URL, E2E_TELEGRAM_URL } from "../env";
import { connectGreenMail, mailboxAddress, seedActivity, signIn } from "../helpers";
import { DEMO_STEPS, stepView, type DemoCue } from "../lib/demo/steps";
import { botBody, urgentNotice } from "../lib/demo/notice";
import { DEMO_VIDEO_SIZE, DEMO_VIEWPORT } from "../lib/demo/record-args";
import { shotSource } from "../lib/shot-source";
import { readSeed } from "../seed";
import { readDemoPlan, setupProblems } from "../lib/demo/setup";
import { collectSetupState, readDemoOwner } from "./setup-run";
import { MINUTE_MS } from "@ea/core";

// The recording of the demo video (the public pages and demo ticket). One page records the whole video: the steps of `DEMO_STEPS` run in
// order, each as one owner of the e2e seed (README.md, the spike table), and the page switches between the panel and the read-only view
// of the fake Telegram. The sign-ins happen before the recording starts, in a context that records nothing: no password or sign-in form is
// in the video. The spec writes the cue times (ms from the video start) and the raw video to `DEMO_WORK_DIR`; the command encodes it.
test.describe.configure({ mode: "serial" });

const WORK_DIR = process.env.DEMO_WORK_DIR ?? "";
// The chat of the Telegram step: made by the first message of the notice, linked to no organization.
const DEMO_CHAT_ID = 9_200_001;
// A client address for each sign-in (the login rate limit counts per address): documentation range 192.0.2.0/24.
const ADDRESS = (n: number): string => `192.0.2.${230 + n}`;

type Owner = "main" | "trust" | "approvals" | "delegations";

// What a viewer sees: the visible text and the values of the fields that are not secret.
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
      .filter((field) => field.type !== "password")
      .map((field) => field.value);
    return [document.body.innerText, ...fields].join("\n");
  });
}

// The state check of the setup (`@setup`): as the owner, the demo organization is ready for the recording. `demo:record --setup-only` runs only
// this test. The e2e source has no demo setup, so the test skips there.
test("the demo setup left the organization ready for the recording @setup", async () => {
  test.skip(shotSource().kind !== "demo", "the e2e source has no demo setup");
  const planFile = process.env.DEMO_PLAN_FILE ?? "";
  if (planFile === "") throw new Error("demo_replay_missing: run bun run demo:record");
  const state = await collectSetupState(readDemoPlan(planFile), readDemoOwner());
  expect(setupProblems(state)).toEqual([]);
});

test("the demo recording follows the eight steps of the script @record", async ({ browser }) => {
  if (WORK_DIR === "") throw new Error("demo_work_dir_missing");
  const source = shotSource().kind;
  if (source !== "e2e") throw new Error("demo_source_recording_not_built");
  mkdirSync(WORK_DIR, { recursive: true });
  const seed = readSeed();
  const project = "desktop";
  const owners: Record<Owner, { email: string; password: string }> = {
    main: seed.owner,
    trust: seed.trustOrgs[project].owner,
    approvals: seed.approvalsOrgs[project].owner,
    delegations: seed.delegationsOrgs[project].owner,
  };

  // eslint-disable-next-line no-console
  console.log("demo_signins start");
  // Sign-ins, off camera: one storage state for each owner.
  const states = {} as Record<Owner, Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>>;
  let at = 0;
  for (const name of Object.keys(owners) as Owner[]) {
    at += 1;
    const login = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { ...DEMO_VIEWPORT },
      extraHTTPHeaders: { "x-forwarded-for": ADDRESS(at) },
    });
    const loginPage = await login.newPage();
    await signIn(loginPage, owners[name].email, owners[name].password);
    await loginPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    states[name] = await login.storageState();
    await login.close();
  }

  // The recording context. The panel reads the language key before the browser language (`apps/web/src/i18n/index.ts`).
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { ...DEMO_VIEWPORT },
    locale: "en-US",
    recordVideo: { dir: join(WORK_DIR, "video"), size: { ...DEMO_VIDEO_SIZE } },
    extraHTTPHeaders: { "x-forwarded-for": ADDRESS(9) },
  });
  await context.addInitScript(() => localStorage.setItem("ea.locale", "en"));
  const page = await context.newPage();
  const startedAt = Date.now();
  const cues: DemoCue[] = [];

  async function become(name: Owner): Promise<void> {
    await context.clearCookies();
    await context.addCookies(states[name].cookies);
  }

  // Runs one step: `act` does the visible work; `during` is work off camera that runs inside the step (it fills the step's time). The
  // page text then passes the public-content check. The step ends after its planned `seconds`, never sooner: a longer `act` makes it longer.
  async function step(id: string, act: () => Promise<void>, during?: () => Promise<void>): Promise<void> {
    const found = DEMO_STEPS.find((candidate) => candidate.id === id);
    const planned = found === undefined ? undefined : stepView(found, source);
    if (planned === undefined) throw new Error(`demo_unknown_step ${id}`);
    const startMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`demo_step ${id} start ${startMs} ms`);
    await act();
    await during?.();
    const [problem] = publicContentScan(
      await pageText(page),
      SHOT_TEXT_ALLOW.map((entry) => entry.text)
    ).problems;
    if (problem !== undefined) throw new Error(`demo_public_content ${id} ${problem.rule} ${problem.match}`);
    const spent = Date.now() - startedAt - startMs;
    if (spent < planned.seconds * 1000) await page.waitForTimeout(planned.seconds * 1000 - spent);
    cues.push({ stepId: id, startMs, endMs: Date.now() - startedAt });
    // eslint-disable-next-line no-console
    console.log(`demo_step ${id} end ${Date.now() - startedAt} ms`);
  }

  let mailboxId = "";

  // 1 connect: a live connect of a GreenMail mailbox; it starts in shadow mode. The activity rows of step 8 are made inside this step.
  await become("main");
  await step(
    "connect",
    async () => {
      await page.goto("/mailboxes?connect=1");
      await expect(page.getByRole("dialog")).toBeVisible();
      await connectGreenMail(page, project);
      await expect(page.getByText(en.mb_mode_shadow).first()).toBeVisible();
    },
    async () => {
      const list = await page.request.get("/api/mailboxes");
      const found = ((await list.json()) as { id: string; address: string }[]).find(
        (entry) => entry.address === mailboxAddress(project)
      );
      if (found === undefined) throw new Error("demo_connected_mailbox_missing");
      mailboxId = found.id;
      seedActivity(mailboxId);
    }
  );

  // 2 shadow (not live: days do not pass in a recording): the trust organization has mailboxes in shadow mode.
  await become("trust");
  const trust = seed.trustOrgs[project];
  await step("shadow", async () => {
    await page.goto("/mailboxes");
    await expect(page.getByRole("heading", { name: en.title_mailboxes, exact: true }).first()).toBeVisible();
    await expect(page.getByText(en.mb_mode_shadow).first()).toBeVisible();
  });

  // 3 report (not live: the check is a seeded row): what the assistant would have done.
  await step("report", async () => {
    await page.goto(`/report?mailbox=${trust.reportMailboxes.done.id}`);
    await expect(page.locator("[data-report-state=done]")).toBeVisible();
    await expect(page.locator("article[data-category=notification]")).toBeVisible();
    await expect(page.getByRole("button", { name: en.rep_check_again })).toBeVisible();
  });

  // 4 recommended (live): the tap turns on the categories that passed the check.
  await step("recommended", async () => {
    const turnOn = page.getByRole("button", {
      name: t("rep_turn_on", { categories: en.cat_notification }),
      exact: true,
    });
    await turnOn.click();
    await expect(page.getByRole("status")).toContainText(
      `${t("rep_turned_on", { categories: en.cat_notification })} ${en.rep_mode_assist}`
    );
  });

  // 5 urgent (not live: with the model off no mail is triaged as urgent): the Telegram notice, rendered by the product renderer, in the
  // read-only view of the fake Telegram.
  await step("urgent", async () => {
    // The fake Bot API sends only into a chat that a user opened: one message of the user makes the chat. The chat is linked to no
    // organization, so the bot ignores it (the count of bot messages is logged below).
    const opened = await fetch(`${E2E_TELEGRAM_URL}/_fake/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: DEMO_CHAT_ID, text: "hello" }),
    });
    if (!opened.ok) throw new Error(`demo_telegram_open ${opened.status}`);
    await page.waitForTimeout(3000);
    const response = await fetch(`${E2E_TELEGRAM_URL}/bot${FAKE_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(botBody(DEMO_CHAT_ID, urgentNotice("en"))),
    });
    if (!response.ok) throw new Error(`demo_telegram_send ${response.status} ${await response.text()}`);
    const chat = (await (await fetch(`${E2E_TELEGRAM_URL}/_fake/chats/${DEMO_CHAT_ID}`)).json()) as {
      messages: { from: string }[];
    };
    // eslint-disable-next-line no-console
    console.log(`demo_telegram_bot_messages ${chat.messages.filter((message) => message.from === "bot").length}`);
    await page.goto(`${E2E_TELEGRAM_URL}/_fake/view?chat=${DEMO_CHAT_ID}&refresh=2`);
    await expect(page.getByText("Signature needed today").first()).toBeVisible();
  });

  // 6 approval (live): edit the text of a waiting reply, save, approve once the committer has made the copy.
  await become("approvals");
  await step("approval", async () => {
    await page.goto(`/approvals?id=${seed.approvalsOrgs[project].editSendId}`);
    const detail = page.getByRole("region", { name: en.appr_detail_label });
    await detail.getByRole("button", { name: en.appr_edit, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: en.appr_edit_title });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: en.appr_edit_body, exact: true })
      .fill("Hello Anna, please send the report.");
    await dialog.getByRole("button", { name: en.save, exact: true }).click();
    await expect(page.getByText(en.appr_edit_saved.replace("{n}", "2"))).toBeVisible();
    // The new version has no copy in the mailbox yet: Approve is off until the committer made it (it runs every 15 seconds).
    const approve = detail.getByRole("button", { name: en.appr_approve, exact: true });
    await expect(approve).toBeEnabled({ timeout: MINUTE_MS });
    await approve.click();
    // The outcome line names the recipient: "Sending to …" first, "Sent to …" once the committer has sent it.
    await expect(page.getByRole("status").filter({ hasText: /^(Sending|Sent) to / })).toBeVisible();
  });

  // 7 delegation (live): the owner asks for the reminder of an overdue task.
  await become("delegations");
  await step("delegation", async () => {
    await page.goto("/delegations");
    const row = page
      .getByRole("list", { name: en.dgn_col_overdue, exact: true })
      .getByRole("listitem")
      .filter({ hasText: E2E_DELEGATIONS.overdue.delegateName });
    await expect(row).toBeVisible();
    await page
      .getByRole("button", { name: en.dgn_remind_for.replace("{name}", E2E_DELEGATIONS.overdue.delegateName) })
      .click();
    await expect(page.locator('[role="status"][tabindex="-1"]')).toContainText(en.dgn_reminded);
  });

  // 8 undo (live): the activity page of the connected mailbox; the committer applies the undo.
  await become("main");
  await step("undo", async () => {
    await page.goto("/activity");
    const moved = page.locator("li[data-email-id]").filter({ hasText: ACTIVITY_SUBJECTS.moved });
    await moved.getByRole("button", { name: en.act_btn_undo, exact: true }).click();
    await expect(page.getByText(en.undo_started)).toBeVisible();
  });

  // Close the page first: the video file is complete only after that.
  const video = page.video();
  await page.close();
  await context.close();
  if (video === null) throw new Error("demo_video_missing");
  await video.saveAs(join(WORK_DIR, "raw.webm"));
  writeFileSync(join(WORK_DIR, "cues.json"), `${JSON.stringify(cues, null, 2)}\n`);
  expect(cues.map((cue) => cue.stepId)).toEqual(DEMO_STEPS.map((candidate) => candidate.id));
});
