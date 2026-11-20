import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_REVIEW_MEMBER_EMAILS,
  E2E_REVIEW_OWNER_EMAILS,
  e2eReviewMailbox,
  e2eReviewOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedReviewRows } from "../lib/e2e-review-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedReview({ db, secretBox }: SeedContext) {
  // One organization per project for the panel review spec. The flags `panel_review` and `trust_ladder` are on; one
  // mailbox with a done history check and 12 real, unlabelled mails. See `e2e-review-rows.ts`.
  const reviewIds = {} as Record<E2eProject, { orgId: string; ownerId: string; memberId: string; mailboxId: string }>;
  for (const project of E2E_PROJECTS) {
    const reviewOwner = await createOrganizationWithOwner(db, {
      orgName: e2eReviewOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_REVIEW_OWNER_EMAILS[project],
      displayName: `E2E Review owner ${project}`,
    });
    const ctx = { orgId: reviewOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_REVIEW_MEMBER_EMAILS[project],
      displayName: `E2E Review member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["panel_review", "trust_ladder"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: reviewOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eReviewMailbox(project));
    await seedReviewRows(db, ctx, mailboxId, new Date());
    reviewIds[project] = { orgId: reviewOwner.orgId, ownerId: reviewOwner.userId, memberId: member.id, mailboxId };
  }
  return { reviewIds };
}

export async function finishReview(
  { requestLink, setPassword }: SeedContext,
  { reviewIds }: Awaited<ReturnType<typeof seedReview>>
) {
  const reviewOrgs = {} as SeedFile["reviewOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_REVIEW_OWNER_EMAILS[project];
    const memberEmail = E2E_REVIEW_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = reviewIds[project];
    reviewOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailbox: { id: ids.mailboxId, address: e2eReviewMailbox(project) },
    };
  }
  return { reviewOrgs };
}
