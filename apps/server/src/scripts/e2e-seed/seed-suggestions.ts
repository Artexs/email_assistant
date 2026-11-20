import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_SUGGESTIONS_MEMBER_EMAILS,
  E2E_SUGGESTIONS_OWNER_EMAILS,
  e2eSuggestionsMailbox,
  e2eSuggestionsOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedSuggestionRows } from "../lib/e2e-suggestion-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedSuggestions({ db, config, secretBox }: SeedContext) {
  // One organization per project for the suggestions spec. The flags `sender_context`, `sender_suggestions` and `sent_sync` are
  // on; one mailbox with three open suggestions and Sent coverage. See `e2e-suggestion-rows.ts`.
  const suggestionIds = {} as Record<
    E2eProject,
    { orgId: string; ownerId: string; memberId: string; mailboxId: string }
  >;
  for (const project of E2E_PROJECTS) {
    const suggestionOwner = await createOrganizationWithOwner(db, {
      orgName: e2eSuggestionsOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_SUGGESTIONS_OWNER_EMAILS[project],
      displayName: `E2E Suggestions owner ${project}`,
    });
    const ctx = { orgId: suggestionOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_SUGGESTIONS_MEMBER_EMAILS[project],
      displayName: `E2E Suggestions member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    for (const flag of ["sender_context", "sender_suggestions", "sent_sync"] as const) {
      await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: suggestionOwner.userId, setAt: new Date() });
    }
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eSuggestionsMailbox(project));
    await seedSuggestionRows(db, ctx, mailboxId, config.CREDENTIALS_KEY, new Date());
    suggestionIds[project] = {
      orgId: suggestionOwner.orgId,
      ownerId: suggestionOwner.userId,
      memberId: member.id,
      mailboxId,
    };
  }
  return { suggestionIds };
}

export async function finishSuggestions(
  { requestLink, setPassword }: SeedContext,
  { suggestionIds }: Awaited<ReturnType<typeof seedSuggestions>>
) {
  const suggestionOrgs = {} as SeedFile["suggestionOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_SUGGESTIONS_OWNER_EMAILS[project];
    const memberEmail = E2E_SUGGESTIONS_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = suggestionIds[project];
    suggestionOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailbox: { id: ids.mailboxId, address: e2eSuggestionsMailbox(project) },
    };
  }
  return { suggestionOrgs };
}
