import { updateMailboxSettings } from "../../modules/config";
import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  e2eReplyPanelMailbox,
  e2eReplyPanelOrgName,
  E2E_REPLY_PANEL_MEMBER_EMAILS,
  E2E_REPLY_PANEL_OWNER_EMAILS,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedReplyPanelRows, type ReplyPanelSeedResult } from "../lib/e2e-reply-panel-rows";

import { seedAssistMailbox, ASSIST_SWITCHES } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedReplyPanel({ db, secretBox }: SeedContext) {
  // One organization per project for the reply panel spec. The flags `approvals_page` and `reply_drafts` are on, and so is the reply
  // switch of the mailbox. See `e2e-reply-panel-rows.ts`.
  const replyPanelIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; mailboxId: string } & ReplyPanelSeedResult
  >;
  for (const project of E2E_PROJECTS) {
    const panelOwner = await createOrganizationWithOwner(db, {
      orgName: e2eReplyPanelOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_REPLY_PANEL_OWNER_EMAILS[project],
      displayName: `E2E Reply Panel owner ${project}`,
    });
    const ctx = { orgId: panelOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_REPLY_PANEL_MEMBER_EMAILS[project],
      displayName: `E2E Reply Panel member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["approvals_page", "reply_drafts"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: panelOwner.userId, setAt: new Date() });
    }
    const address = e2eReplyPanelMailbox(project);
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, address);
    await db.transaction().execute((trx) =>
      updateMailboxSettings(trx, ctx, mailboxId, {
        mode: "assist",
        toolSwitches: { ...ASSIST_SWITCHES, reply_drafts: true },
      })
    );
    const rows = await seedReplyPanelRows(db, ctx, mailboxId, address, panelOwner.userId, new Date());
    replyPanelIds[project] = {
      orgId: panelOwner.orgId,
      ownerId: panelOwner.userId,
      memberId: member.id,
      mailboxId,
      ...rows,
    };
  }
  return { replyPanelIds };
}

export async function finishReplyPanel(
  { requestLink, setPassword }: SeedContext,
  { replyPanelIds }: Awaited<ReturnType<typeof seedReplyPanel>>
) {
  const replyPanelOrgs = {} as SeedFile["replyPanelOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_REPLY_PANEL_OWNER_EMAILS[project];
    const memberEmail = E2E_REPLY_PANEL_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = replyPanelIds[project];
    replyPanelOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailbox: { id: ids.mailboxId, address: e2eReplyPanelMailbox(project) },
      sendIds: ids.sendIds,
      mailIds: ids.mailIds,
    };
  }
  return { replyPanelOrgs };
}
