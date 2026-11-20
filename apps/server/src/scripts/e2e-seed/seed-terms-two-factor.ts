import { createOrganizationWithOwner, setUserTerms } from "../../modules/tenancy";
import {
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TERMS_EMAILS,
  e2eTermsOrgName,
  E2E_TWO_FACTOR_EMAILS,
  e2eTwoFactorOrgName,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";

import type { SeedContext } from "./seed-context";

export async function seedTermsTwoFactor({ db }: SeedContext) {
  // One organization per project with an owner whose accepted terms are old: the panel shows the terms dialog.
  const termsIds = {} as Record<E2eProject, string>;
  for (const project of E2E_PROJECTS) {
    const termsOwner = await createOrganizationWithOwner(db, {
      orgName: e2eTermsOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_TERMS_EMAILS[project],
      displayName: `E2E Terms ${project}`,
    });
    termsIds[project] = termsOwner.userId;
  }

  // One organization per project with an owner whose second factor starts off: the two-factor spec turns it on and off.
  const twoFactorIds = {} as Record<E2eProject, { userId: string; orgId: string }>;
  for (const project of E2E_PROJECTS) {
    const twoFactorOwner = await createOrganizationWithOwner(db, {
      orgName: e2eTwoFactorOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_TWO_FACTOR_EMAILS[project],
      displayName: `E2E Two-factor ${project}`,
    });
    twoFactorIds[project] = { userId: twoFactorOwner.userId, orgId: twoFactorOwner.orgId };
  }
  return { termsIds, twoFactorIds };
}

export async function finishTermsTwoFactor(
  { db, requestLink, setPassword }: SeedContext,
  { termsIds, twoFactorIds }: Awaited<ReturnType<typeof seedTermsTwoFactor>>
) {
  // The reset stores the current terms; the terms owners then go back to an old version.
  const termsOwners = {} as SeedFile["termsOwners"];
  for (const project of E2E_PROJECTS) {
    const email = E2E_TERMS_EMAILS[project];
    const termsToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
    await setPassword(E2E_MEMBER_PASSWORD, termsToken);
    await setUserTerms(db, termsIds[project], "2000-01-01", new Date());
    termsOwners[project] = { userId: termsIds[project], email, password: E2E_MEMBER_PASSWORD };
  }

  const twoFactorOwners = {} as SeedFile["twoFactorOwners"];
  for (const project of E2E_PROJECTS) {
    const email = E2E_TWO_FACTOR_EMAILS[project];
    const twoFactorToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
    await setPassword(E2E_MEMBER_PASSWORD, twoFactorToken);
    twoFactorOwners[project] = { ...twoFactorIds[project], email, password: E2E_MEMBER_PASSWORD };
  }
  return { termsOwners, twoFactorOwners };
}
