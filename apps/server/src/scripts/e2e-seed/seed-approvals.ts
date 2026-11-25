import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_APPROVALS_MEMBER_EMAILS,
  E2E_APPROVALS_OWNER_EMAILS,
  E2E_QUEUE_OWNER_EMAILS,
  e2eApprovalsMailbox,
  e2eApprovalsOrgName,
  e2eQueueMailbox,
  e2eQueueOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedApprovalsRows, seedQueueRows } from "../lib/e2e-approvals-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedApprovals({ db, secretBox }: SeedContext) {
  // One organization per project for the approvals spec. The flags are on; the mailbox is the GreenMail of the dev
  // stack, so an approved send to the delegate that SEND_SCOPE=self admits goes out and leaves the list. See `e2e-approvals-rows.ts`.
  const approvalsIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string } & Awaited<ReturnType<typeof seedApprovalsRows>>
  >;
  for (const project of E2E_PROJECTS) {
    const approvalsOwner = await createOrganizationWithOwner(db, {
      orgName: e2eApprovalsOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_APPROVALS_OWNER_EMAILS[project],
      displayName: `E2E Approvals owner ${project}`,
    });
    const ctx = { orgId: approvalsOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_APPROVALS_MEMBER_EMAILS[project],
      displayName: `E2E Approvals member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["approvals_page", "stats_page", "mistake_capture"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: approvalsOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eApprovalsMailbox(project));
    const rows = await seedApprovalsRows(db, ctx, mailboxId, approvalsOwner.userId, new Date());
    approvalsIds[project] = {
      orgId: approvalsOwner.orgId,
      ownerId: approvalsOwner.userId,
      memberId: member.id,
      ...rows,
    };
  }
  // The queue spec's organizations: one owner each, five waiting drafts and a held send.
  const queueIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string } & Awaited<ReturnType<typeof seedQueueRows>>
  >;
  for (const project of E2E_PROJECTS) {
    const queueOwner = await createOrganizationWithOwner(db, {
      orgName: e2eQueueOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_QUEUE_OWNER_EMAILS[project],
      displayName: `E2E Queue owner ${project}`,
    });
    const ctx = { orgId: queueOwner.orgId };
    for (const flag of ["approvals_page", "mistake_capture"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: queueOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eQueueMailbox(project));
    const rows = await seedQueueRows(db, ctx, mailboxId, queueOwner.userId, new Date());
    queueIds[project] = { orgId: queueOwner.orgId, ownerId: queueOwner.userId, ...rows };
  }
  return { approvalsIds, queueIds };
}

export async function finishApprovals(
  { requestLink, setPassword }: SeedContext,
  { approvalsIds, queueIds }: Awaited<ReturnType<typeof seedApprovals>>
) {
  const approvalsOrgs = {} as SeedFile["approvalsOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_APPROVALS_OWNER_EMAILS[project];
    const memberEmail = E2E_APPROVALS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = approvalsIds[project];
    approvalsOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      waitingSendId: ids.waitingSendId,
      heldSendId: ids.heldSendId,
      editSendId: ids.editSendId,
      closedSendId: ids.closedSendId,
      raceSendId: ids.raceSendId,
      reminderSendId: ids.reminderSendId,
    };
  }
  const queueOrgs = {} as SeedFile["queueOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_QUEUE_OWNER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    const ids = queueIds[project];
    queueOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      waitingSendIds: ids.waitingSendIds,
      heldSendId: ids.heldSendId,
    };
  }
  return { approvalsOrgs, queueOrgs };
}
