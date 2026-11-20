import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_DELEGATES_ANNA,
  E2E_DELEGATES_MEMBER_EMAILS,
  E2E_DELEGATES_OWNER_EMAILS,
  e2eDelegatesOrgName,
  e2eDelegatesMailbox,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedDelegates({ db, secretBox }: SeedContext) {
  // One organization per project for the delegates spec. The flag `delegation_pages` is on; one delegate (Anna Nowak,
  // tag `finance`) and a mailbox.
  const delegatesIds = {} as Record<E2eProject, { orgId: string; ownerId: string; memberId: string }>;
  for (const project of E2E_PROJECTS) {
    const delegatesOwner = await createOrganizationWithOwner(db, {
      orgName: e2eDelegatesOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_DELEGATES_OWNER_EMAILS[project],
      displayName: `E2E Delegates owner ${project}`,
    });
    const ctx = { orgId: delegatesOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_DELEGATES_MEMBER_EMAILS[project],
      displayName: `E2E Delegates member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "delegation_pages",
      enabled: true,
      setBy: delegatesOwner.userId,
      setAt: new Date(),
    });
    await db
      .insertInto("delegates")
      .values({
        org_id: ctx.orgId,
        name: E2E_DELEGATES_ANNA.name,
        email: E2E_DELEGATES_ANNA.email,
        competence_tags: [...E2E_DELEGATES_ANNA.tags],
      })
      .execute();
    // A mailbox address: adding it as a delegate gives 400 `mailbox_address` (the delegates spec).
    await seedAssistMailbox(db, secretBox, ctx, e2eDelegatesMailbox(project));
    delegatesIds[project] = { orgId: delegatesOwner.orgId, ownerId: delegatesOwner.userId, memberId: member.id };
  }
  return { delegatesIds };
}

export async function finishDelegates(
  { requestLink, setPassword }: SeedContext,
  { delegatesIds }: Awaited<ReturnType<typeof seedDelegates>>
) {
  const delegatesOrgs = {} as SeedFile["delegatesOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_DELEGATES_OWNER_EMAILS[project];
    const memberEmail = E2E_DELEGATES_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = delegatesIds[project];
    delegatesOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailboxAddress: e2eDelegatesMailbox(project),
    };
  }
  return { delegatesOrgs };
}
