import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  e2eOpenLoopsMailbox,
  e2eOpenLoopsOrgName,
  E2E_OPEN_LOOPS_MEMBER_EMAILS,
  E2E_OPEN_LOOPS_OWNER_EMAILS,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedOpenLoopsRows } from "../lib/e2e-open-loops-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedOpenLoops({ db, secretBox }: SeedContext) {
  // One organization per project for the open loops page spec (`open-loops.spec.ts`). The flags `open_loops`,
  // `delegation_pages` and `approvals_page` are on; the mailbox is in assist mode with drafts on. See `e2e-open-loops-rows.ts`.
  const openLoopsIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; rows: Awaited<ReturnType<typeof seedOpenLoopsRows>> }
  >;
  for (const project of E2E_PROJECTS) {
    const openOwner = await createOrganizationWithOwner(db, {
      orgName: e2eOpenLoopsOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_OPEN_LOOPS_OWNER_EMAILS[project],
      displayName: `E2E Open Loops owner ${project}`,
    });
    const ctx = { orgId: openOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_OPEN_LOOPS_MEMBER_EMAILS[project],
      displayName: `E2E Open Loops member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["open_loops", "delegation_pages", "approvals_page"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: openOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eOpenLoopsMailbox(project));
    const rows = await seedOpenLoopsRows(db, ctx, mailboxId, openOwner.userId, new Date());
    openLoopsIds[project] = { orgId: openOwner.orgId, ownerId: openOwner.userId, memberId: member.id, rows };
  }
  return { openLoopsIds };
}

export async function finishOpenLoops(
  { requestLink, setPassword }: SeedContext,
  { openLoopsIds }: Awaited<ReturnType<typeof seedOpenLoops>>
) {
  const openLoopsOrgs = {} as SeedFile["openLoopsOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_OPEN_LOOPS_OWNER_EMAILS[project];
    const memberEmail = E2E_OPEN_LOOPS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = openLoopsIds[project];
    openLoopsOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      ...ids.rows,
    };
  }
  return { openLoopsOrgs };
}
