import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_NEWSLETTERS_MEMBER_EMAILS,
  E2E_NEWSLETTERS_OWNER_EMAILS,
  e2eNewslettersMailbox,
  e2eNewslettersOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedNewsletterRows } from "../lib/e2e-newsletter-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedNewsletters({ db, secretBox }: SeedContext) {
  // One organization per project for the newsletters spec. The flag `bulk_unsubscribe` is on; one mailbox with five
  // newsletter senders and one request. See `e2e-newsletter-rows.ts`.
  const newsletterIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; mailboxId: string }
  >;
  for (const project of E2E_PROJECTS) {
    const newsletterOwner = await createOrganizationWithOwner(db, {
      orgName: e2eNewslettersOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_NEWSLETTERS_OWNER_EMAILS[project],
      displayName: `E2E Newsletters owner ${project}`,
    });
    const ctx = { orgId: newsletterOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_NEWSLETTERS_MEMBER_EMAILS[project],
      displayName: `E2E Newsletters member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "bulk_unsubscribe",
      enabled: true,
      setBy: newsletterOwner.userId,
      setAt: new Date(),
    });
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eNewslettersMailbox(project));
    await seedNewsletterRows(db, ctx, mailboxId, new Date());
    newsletterIds[project] = {
      orgId: newsletterOwner.orgId,
      ownerId: newsletterOwner.userId,
      memberId: member.id,
      mailboxId,
    };
  }
  return { newsletterIds };
}

export async function finishNewsletters(
  { requestLink, setPassword }: SeedContext,
  { newsletterIds }: Awaited<ReturnType<typeof seedNewsletters>>
) {
  const newsletterOrgs = {} as SeedFile["newsletterOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_NEWSLETTERS_OWNER_EMAILS[project];
    const memberEmail = E2E_NEWSLETTERS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = newsletterIds[project];
    newsletterOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailbox: { id: ids.mailboxId, address: e2eNewslettersMailbox(project) },
    };
  }
  return { newsletterOrgs };
}
