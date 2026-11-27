import { randomBytes } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import type { ActivityWebPage, ApprovalList, DelegationList, MailboxView, TrustView } from "@ea/core/web";
import { expect } from "@playwright/test";

import { createFakeTelegramClient } from "../../../../tools/fake-telegram/src/driver";
import { en } from "../../src/i18n/en";
import { E2E_TELEGRAM_URL } from "../env";
import { connectGreenMail } from "../helpers";
import type { DemoMail, DemoRunPlan } from "../lib/demo/run-plan";
import { DEMO_CHAT_ID, hasPausedNotice, liveMessages } from "../lib/demo/setup";
import {
  afterTapMissing,
  delegationApproval,
  firstSynced,
  historyCheckState,
  remindTarget,
  shadowTriaged,
  waitUntil,
} from "../lib/demo/waits";
import { deliverToB, MAILBOX_B_PASSWORD, type OwnerApi } from "./setup-run";
import type { StepKit } from "./steps-kit";

// The eight steps of the demo source (the F151 plan: one organization, two mailboxes, polled waits). Every step is live, on mailbox B of the demo organization: the mail that the
// steps need arrives during the recording through IMAP, and the replay model of the demo week classifies it. The waits run off camera,
// between two steps (the encode cuts every gap); the API reads of the waits use their own session (`api`), never the recorded page.
export async function runDemoSteps({ page, become, step }: StepKit, plan: DemoRunPlan, api: OwnerApi): Promise<void> {
  const mailboxB = plan.mailboxB;
  const telegram = createFakeTelegramClient(E2E_TELEGRAM_URL);
  const runTag = randomBytes(2).toString("hex");
  let nextSeq = plan.history.length + 1;

  const botTexts = async (): Promise<string[]> =>
    (await telegram.read({ chatId: DEMO_CHAT_ID }))
      .filter((message) => message.from === "bot")
      .map((message) => message.text);
  const deliver = async (mails: readonly DemoMail[]): Promise<void> => {
    await deliverToB(mailboxB, liveMessages(mails, { to: mailboxB, firstSeq: nextSeq, runTag, now: new Date() }));
    nextSeq += mails.length;
  };
  const mailboxes = async (): Promise<MailboxView[]> => api.get<MailboxView[]>("/mailboxes");
  const activityOfB = async (id: string): Promise<ActivityWebPage["items"]> =>
    (await api.get<ActivityWebPage>(`/activity?mailboxId=${id}&limit=100`)).items;
  const approvals = async (): Promise<ApprovalList["items"]> => (await api.get<ApprovalList>("/approvals")).items;

  await become("main");

  // 1 connect: B joins live and starts in shadow mode. Off camera: the first sync, then 4 shadow mails and their triage.
  await step("connect", async () => {
    await page.goto("/mailboxes?connect=1");
    await expect(page.getByRole("dialog")).toBeVisible();
    await connectGreenMail(page, "demo", { address: mailboxB, password: MAILBOX_B_PASSWORD });
    await expect(page.getByText(en.mb_mode_shadow).first()).toBeVisible();
  });
  const found = (await mailboxes()).find((mailbox) => mailbox.address.toLowerCase() === mailboxB.toLowerCase());
  if (found === undefined) throw new Error("demo_connected_mailbox_missing");
  const id = found.id;
  await waitUntil("firstSync", async () => firstSynced(await mailboxes(), mailboxB));
  await deliver(plan.shadow);
  await waitUntil("shadowTriaged", async () => shadowTriaged(await activityOfB(id), plan));

  // 2 shadow: the 4 mails with what the assistant would do with each. Off camera: the history check ends.
  await step("shadow", async () => {
    await page.goto(`/activity?mailbox=${id}`);
    for (const mail of plan.shadow) await expect(page.getByText(mail.subject).first()).toBeVisible();
  });
  await waitUntil("historyDone", async () => {
    const state = historyCheckState((await api.get<TrustView>(`/trust/${id}`)).check);
    if (state.startsWith("demo_")) throw new Error(state);
    return state === "done";
  });

  // 3 report: the history check is done; the page shows the counts.
  await step("report", async () => {
    await page.goto(`/report?mailbox=${id}`);
    await expect(page.locator("[data-report-state=done]")).toBeVisible();
    await expect(page.getByRole("button", { name: en.rep_check_again })).toBeVisible();
  });

  // 4 recommended: one tap turns the passed categories on and B goes to assist. Off camera: drafts on for B, then the 3 live mails and the
  // wait for their results (the urgent notice, the delegation draft with its copy, the move of the undo mail).
  await step("recommended", async () => {
    const turnOn = page.getByRole("button", { name: new RegExp(`^${en.rep_turn_on.split(" (")[0] ?? ""}`) });
    await turnOn.click();
    await expect(page.getByRole("status")).toContainText(en.rep_mode_assist);
  });
  await api.patch(`/settings/${id}/switches/create_draft`, { value: true });
  await deliver([plan.urgent, plan.delegation, plan.undo]);
  await waitUntil("afterTap", async () => {
    const missing = afterTapMissing(
      { botTexts: await botTexts(), approvals: await approvals(), activity: await activityOfB(id) },
      plan,
      mailboxB
    );
    // eslint-disable-next-line no-console
    if (missing.length > 0) console.log(`demo_wait_missing afterTap ${missing.join(",")}`);
    return missing.length === 0;
  });

  // 5 urgent: the notice in the read-only view of the fake Telegram. The `autonomy_paused` notice would show here too: a re-gate after the
  // setup must not have sent it.
  await step("urgent", async () => {
    if (hasPausedNotice(await botTexts())) throw new Error("demo_autonomy_paused_notice");
    await page.goto(`${E2E_TELEGRAM_URL}/_fake/view?chat=${DEMO_CHAT_ID}&refresh=2`);
    await expect(page.getByText(plan.urgent.subject).first()).toBeVisible();
  });

  // 6 approval: the delegation draft waits for a tap: edit, save, approve. Off camera: the committer sends it to the delegate.
  const send = delegationApproval(await approvals(), mailboxB);
  if (send === undefined || send.delegationId === null) throw new Error("demo_delegation_send_missing");
  const delegationId = send.delegationId;
  await step("approval", async () => {
    await page.goto(`/approvals?id=${send.id}`);
    const detail = page.getByRole("region", { name: en.appr_detail_label });
    await detail.getByRole("button", { name: en.appr_edit, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: en.appr_edit_title });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: en.appr_edit_body, exact: true })
      .fill("Hello, please send me a short update on this today.");
    await dialog.getByRole("button", { name: en.save, exact: true }).click();
    await expect(page.getByText(en.appr_edit_saved.replace("{n}", "2"))).toBeVisible();
    // The new version has no copy in the mailbox yet: Approve is off until the committer made it (it runs every 15 seconds).
    const approve = detail.getByRole("button", { name: en.appr_approve, exact: true });
    await expect(approve).toBeEnabled({ timeout: MINUTE_MS });
    await approve.click();
    await expect(page.getByRole("status").filter({ hasText: /^(Sending|Sent) to / })).toBeVisible();
  });
  await waitUntil("delegationSent", async () => {
    const list = await api.get<DelegationList>("/delegations?filter=open&limit=100");
    return remindTarget(list.items, delegationId) !== undefined;
  });

  // 7 delegation: "Remind now" on the delegation of step 6 (never the `overdueDelegation` of the plan: no seed of this run fills it). The row is found by its id: the
  // imported mailbox may hold other rows of the same delegate.
  const target = remindTarget(
    (await api.get<DelegationList>("/delegations?filter=open&limit=100")).items,
    delegationId
  );
  if (target === undefined) throw new Error("demo_remind_target_missing");
  await step("delegation", async () => {
    await page.goto("/delegations");
    const row = page.locator(`#delegation-row-${target.id}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: en.dgn_remind_for.replace("{name}", target.delegate.name) }).click();
    await expect(page.locator('[role="status"][tabindex="-1"]')).toContainText(en.dgn_reminded);
  });

  // 8 undo: Undo on the mail that the assistant moved.
  await step("undo", async () => {
    await page.goto(`/activity?mailbox=${id}`);
    const moved = page.locator("li[data-email-id]").filter({ hasText: plan.undo.subject }).first();
    await moved.getByRole("button", { name: en.act_btn_undo, exact: true }).click();
    await expect(page.getByText(en.undo_started)).toBeVisible();
  });
}
