import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  e2eDelegationsMailbox,
  e2eDelegationsOrgName,
  E2E_DELEGATIONS_MEMBER_EMAILS,
  E2E_DELEGATIONS_OWNER_EMAILS,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedDelegationsRows } from "../lib/e2e-delegations-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedDelegations({ db, secretBox }: SeedContext) {
  // One organization per project for the delegations spec. The three flags are on (a full phone tab bar); the
  // mailbox is in assist mode with drafts on; one delegation for each case of the page. See `e2e-delegations-rows.ts`.
  const delegationsIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; draftedSendId: string }
  >;
  for (const project of E2E_PROJECTS) {
    const delegationsOwner = await createOrganizationWithOwner(db, {
      orgName: e2eDelegationsOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_DELEGATIONS_OWNER_EMAILS[project],
      displayName: `E2E Delegations owner ${project}`,
    });
    const ctx = { orgId: delegationsOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_DELEGATIONS_MEMBER_EMAILS[project],
      displayName: `E2E Delegations member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["delegation_pages", "approvals_page", "stats_page"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: delegationsOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eDelegationsMailbox(project));
    const rows = await seedDelegationsRows(db, ctx, mailboxId, delegationsOwner.userId, new Date());
    delegationsIds[project] = {
      orgId: delegationsOwner.orgId,
      ownerId: delegationsOwner.userId,
      memberId: member.id,
      ...rows,
    };
  }
  return { delegationsIds };
}

export async function finishDelegations(
  { requestLink, setPassword }: SeedContext,
  { delegationsIds }: Awaited<ReturnType<typeof seedDelegations>>
) {
  const delegationsOrgs = {} as SeedFile["delegationsOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_DELEGATIONS_OWNER_EMAILS[project];
    const memberEmail = E2E_DELEGATIONS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = delegationsIds[project];
    delegationsOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      draftedSendId: ids.draftedSendId,
    };
  }
  return { delegationsOrgs };
}
