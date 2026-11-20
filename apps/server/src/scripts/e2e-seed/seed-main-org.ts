import { createOrganizationWithOwner, insertMembership, insertUser } from "../../modules/tenancy";
import {
  E2E_ACTIVITY_MEMBER_EMAILS,
  E2E_ASSISTANT_EMAILS,
  E2E_MEMBER_EMAILS,
  E2E_MEMBER_PASSWORD,
  E2E_ORG_NAME,
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  E2E_PAUSED_OWNER_EMAIL,
  E2E_PROJECTS,
  E2E_STATS_OWNER_EMAIL,
  E2E_TRIAL_OWNER_EMAIL,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";

import type { SeedContext } from "./seed-context";

export async function seedMainOrg({ db }: SeedContext) {
  const owner = await createOrganizationWithOwner(db, {
    orgName: E2E_ORG_NAME,
    timezone: "Europe/Warsaw",
    email: E2E_OWNER_EMAIL,
    displayName: "E2E Owner",
  });
  const assistantIds = {} as Record<E2eProject, string>;
  for (const project of E2E_PROJECTS) {
    const user = await insertUser(db, {
      email: E2E_ASSISTANT_EMAILS[project],
      displayName: `E2E Assistant ${project}`,
    });
    await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
    assistantIds[project] = user.id;
  }

  const memberIds = {} as Record<E2eProject, string>;
  for (const project of E2E_PROJECTS) {
    const user = await insertUser(db, {
      email: E2E_MEMBER_EMAILS[project],
      displayName: `E2E Member ${project}`,
    });
    await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
    memberIds[project] = user.id;
  }

  const activityIds = {} as Record<E2eProject, string>;
  for (const project of E2E_PROJECTS) {
    const user = await insertUser(db, {
      email: E2E_ACTIVITY_MEMBER_EMAILS[project],
      displayName: `E2E Activity ${project}`,
    });
    await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
    activityIds[project] = user.id;
  }
  return { owner, assistantIds, memberIds, activityIds };
}

export async function finishMainOrg(
  { requestLink, setPassword }: SeedContext,
  {
    assistantIds,
    memberIds,
    activityIds,
  }: Pick<Awaited<ReturnType<typeof seedMainOrg>>, "assistantIds" | "memberIds" | "activityIds">
) {
  const ownerLink = await requestLink(E2E_OWNER_EMAIL);
  const token = new URL(ownerLink).pathname.split("/").pop() ?? "";
  await setPassword(E2E_OWNER_PASSWORD, token);

  for (const email of [E2E_TRIAL_OWNER_EMAIL, E2E_PAUSED_OWNER_EMAIL, E2E_STATS_OWNER_EMAIL]) {
    const planToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
    await setPassword(E2E_OWNER_PASSWORD, planToken);
  }

  const assistants = {} as SeedFile["assistants"];
  for (const project of E2E_PROJECTS) {
    const email = E2E_ASSISTANT_EMAILS[project];
    assistants[project] = { userId: assistantIds[project], email, setupUrl: await requestLink(email) };
  }

  const members = {} as SeedFile["members"];
  for (const project of E2E_PROJECTS) {
    const email = E2E_MEMBER_EMAILS[project];
    const memberToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
    await setPassword(E2E_MEMBER_PASSWORD, memberToken);
    members[project] = { userId: memberIds[project], email, password: E2E_MEMBER_PASSWORD };
  }

  const activityMembers = {} as SeedFile["activityMembers"];
  for (const project of E2E_PROJECTS) {
    const email = E2E_ACTIVITY_MEMBER_EMAILS[project];
    const activityToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
    await setPassword(E2E_MEMBER_PASSWORD, activityToken);
    activityMembers[project] = { userId: activityIds[project], email, password: E2E_MEMBER_PASSWORD };
  }
  return { assistants, members, activityMembers };
}
