import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_REPLY_STYLE_MEMBER_EMAILS,
  E2E_REPLY_STYLE_OWNER_EMAILS,
  e2eReplyStyleMailbox,
  e2eReplyStyleOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedReplyStyle({ db, secretBox }: SeedContext) {
  // One organization per project for the style card spec. The flag `reply_drafts` is on; two mailboxes in assist mode,
  // one with a password and one that signs in with a provider (the reply drafts switch is disabled for it).
  const replyStyleIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; boxId: string; oauthId: string }
  >;
  for (const project of E2E_PROJECTS) {
    const replyOwner = await createOrganizationWithOwner(db, {
      orgName: e2eReplyStyleOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_REPLY_STYLE_OWNER_EMAILS[project],
      displayName: `E2E Reply Style owner ${project}`,
    });
    const ctx = { orgId: replyOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_REPLY_STYLE_MEMBER_EMAILS[project],
      displayName: `E2E Reply Style member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "reply_drafts",
      enabled: true,
      setBy: replyOwner.userId,
      setAt: new Date(),
    });
    const boxId = await seedAssistMailbox(db, secretBox, ctx, e2eReplyStyleMailbox(project, "box"));
    const oauthId = await seedAssistMailbox(db, secretBox, ctx, e2eReplyStyleMailbox(project, "oauth"), "assist", {
      oauthProvider: "google",
    });
    replyStyleIds[project] = {
      orgId: replyOwner.orgId,
      ownerId: replyOwner.userId,
      memberId: member.id,
      boxId,
      oauthId,
    };
  }
  return { replyStyleIds };
}

export async function finishReplyStyle(
  { requestLink, setPassword }: SeedContext,
  { replyStyleIds }: Awaited<ReturnType<typeof seedReplyStyle>>
) {
  const replyStyleOrgs = {} as SeedFile["replyStyleOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_REPLY_STYLE_OWNER_EMAILS[project];
    const memberEmail = E2E_REPLY_STYLE_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = replyStyleIds[project];
    replyStyleOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      box: { id: ids.boxId, address: e2eReplyStyleMailbox(project, "box") },
      oauth: { id: ids.oauthId, address: e2eReplyStyleMailbox(project, "oauth") },
    };
  }
  return { replyStyleOrgs };
}
