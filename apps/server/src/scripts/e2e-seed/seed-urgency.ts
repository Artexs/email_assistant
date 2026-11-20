import { setUrgencyProfile } from "../../modules/config";
import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_URGENCY_MEMBER_EMAILS,
  E2E_URGENCY_OWNER_EMAILS,
  e2eUrgencyMailbox,
  e2eUrgencyOrgName,
  e2eUrgencyProfile,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedUrgency({ db, secretBox }: SeedContext) {
  // One organization per project for the urgency editor spec. The flag `urgency_editor` is on; two mailboxes, one
  // with a profile (a topic, a deadline of yesterday, a deadline in ten days) and one without.
  const urgencyIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; seededId: string; emptyId: string }
  >;
  for (const project of E2E_PROJECTS) {
    const urgencyOwner = await createOrganizationWithOwner(db, {
      orgName: e2eUrgencyOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_URGENCY_OWNER_EMAILS[project],
      displayName: `E2E Urgency owner ${project}`,
    });
    const ctx = { orgId: urgencyOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_URGENCY_MEMBER_EMAILS[project],
      displayName: `E2E Urgency member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "urgency_editor",
      enabled: true,
      setBy: urgencyOwner.userId,
      setAt: new Date(),
    });
    const seededId = await seedAssistMailbox(db, secretBox, ctx, e2eUrgencyMailbox(project, "seeded"));
    const emptyId = await seedAssistMailbox(db, secretBox, ctx, e2eUrgencyMailbox(project, "empty"));
    await setUrgencyProfile(db, ctx, seededId, e2eUrgencyProfile(new Date()), { via: "cli" });
    urgencyIds[project] = {
      orgId: urgencyOwner.orgId,
      ownerId: urgencyOwner.userId,
      memberId: member.id,
      seededId,
      emptyId,
    };
  }
  return { urgencyIds };
}

export async function finishUrgency(
  { requestLink, setPassword }: SeedContext,
  { urgencyIds }: Awaited<ReturnType<typeof seedUrgency>>
) {
  const urgencyOrgs = {} as SeedFile["urgencyOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_URGENCY_OWNER_EMAILS[project];
    const memberEmail = E2E_URGENCY_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = urgencyIds[project];
    urgencyOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      seeded: { id: ids.seededId, address: e2eUrgencyMailbox(project, "seeded") },
      empty: { id: ids.emptyId, address: e2eUrgencyMailbox(project, "empty") },
    };
  }
  return { urgencyOrgs };
}
