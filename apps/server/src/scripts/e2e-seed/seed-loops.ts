import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_DELEGATES_ANNA,
  E2E_LOOPS_CHAT_IDS,
  E2E_LOOPS_MEMBER_EMAILS,
  E2E_LOOPS_OWNER_EMAILS,
  e2eLoopsMailbox,
  e2eLoopsOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedLoopsRows } from "../lib/e2e-loops-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedLoops({ db, secretBox }: SeedContext) {
  // One organization per project for the loops spec. The flags `open_loops`, `delegate_button`, `delegation_pages`,
  // `sent_sync` and `approvals_page` are on; one active delegate; a mailbox in assist mode with drafts on that tracks Sent; the owner is linked to
  // Telegram with a consent of an old version. See `e2e-loops-rows.ts`.
  const loopsIds = {} as Record<E2eProject, { orgId: string; ownerId: string; memberId: string; mailboxId: string }>;
  for (const project of E2E_PROJECTS) {
    const loopsOwner = await createOrganizationWithOwner(db, {
      orgName: e2eLoopsOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_LOOPS_OWNER_EMAILS[project],
      displayName: `E2E Loops owner ${project}`,
    });
    const ctx = { orgId: loopsOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_LOOPS_MEMBER_EMAILS[project],
      displayName: `E2E Loops member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["open_loops", "delegate_button", "delegation_pages", "sent_sync", "approvals_page"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: loopsOwner.userId, setAt: new Date() });
    }
    await db
      .insertInto("delegates")
      .values({
        org_id: ctx.orgId,
        name: E2E_DELEGATES_ANNA.name,
        email: E2E_DELEGATES_ANNA.email,
        competence_tags: [...E2E_DELEGATES_ANNA.tags],
      })
      .execute();
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eLoopsMailbox(project));
    await seedLoopsRows(db, ctx, mailboxId, loopsOwner.userId, E2E_LOOPS_CHAT_IDS[project], new Date());
    loopsIds[project] = { orgId: loopsOwner.orgId, ownerId: loopsOwner.userId, memberId: member.id, mailboxId };
  }
  return { loopsIds };
}

export async function finishLoops(
  { requestLink, setPassword }: SeedContext,
  { loopsIds }: Awaited<ReturnType<typeof seedLoops>>
) {
  const loopsOrgs = {} as SeedFile["loopsOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_LOOPS_OWNER_EMAILS[project];
    const memberEmail = E2E_LOOPS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = loopsIds[project];
    loopsOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailboxId: ids.mailboxId,
    };
  }
  return { loopsOrgs };
}
