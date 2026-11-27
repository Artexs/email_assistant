import { expect } from "@playwright/test";

import { FAKE_TOKEN } from "../../../../tools/fake-telegram/src/state";
import { MINUTE_MS } from "@ea/core";
import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { ACTIVITY_SUBJECTS, E2E_DELEGATIONS } from "../../../server/src/scripts/e2e-seed-args";
import { E2E_TELEGRAM_URL } from "../env";
import { connectGreenMail, mailboxAddress, seedActivity } from "../helpers";
import { botBody, urgentNotice } from "../lib/demo/notice";
import { readSeed } from "../seed";
import { DEMO_CHAT_ID } from "../lib/demo/setup";
import type { StepKit } from "./steps-kit";

// The eight steps of the e2e source: each step is one owner of the e2e seed (README.md, the spike table). Steps 2, 3 and 5 show state
// that the seed holds (the model is off), so the video of this source is never an upload candidate.
export async function runE2eSteps({ page, become, step }: StepKit): Promise<void> {
  const seed = readSeed();
  const project = "desktop";
  // 1 connect: a live connect of a GreenMail mailbox; it starts in shadow mode. The activity rows of step 8 are made off camera, after
  // the step.
  await become("main");
  await step("connect", async () => {
    await page.goto("/mailboxes?connect=1");
    await expect(page.getByRole("dialog")).toBeVisible();
    await connectGreenMail(page, project);
    await expect(page.getByText(en.mb_mode_shadow).first()).toBeVisible();
  });
  const list = await page.request.get("/api/mailboxes");
  const found = ((await list.json()) as { id: string; address: string }[]).find(
    (entry) => entry.address === mailboxAddress(project)
  );
  if (found === undefined) throw new Error("demo_connected_mailbox_missing");
  seedActivity(found.id);

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
}
