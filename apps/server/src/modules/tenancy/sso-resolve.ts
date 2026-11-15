import type { SsoIdentity, SsoRefusal, SsoResolution } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";

import { isFeatureOn } from "./features";
import {
  getSsoLinkUserId,
  getSsoProviderByProviderId,
  getUserIdByEmail,
  hasOtherSsoAccount,
  listMembershipsOfUser,
} from "./repo";
import { hasMailDomain } from "./sso-provider";

const GOOGLE_ISSUER = "https://accounts.google.com";

const reject = (code: SsoRefusal, orgId: string | null): SsoResolution => ({ kind: "reject", code, orgId });

// The tenant of a user is the organization of the oldest membership (`requireTenant`).
async function oldestOrgIdOf(db: Db | Transaction<DB>, userId: string): Promise<string | undefined> {
  const [first] = await listMembershipsOfUser(db, userId);
  return first?.org_id;
}

// Who may sign in through the provider of an organization (F119 D5, PD-041). Never creates a user, and never answers
// "continue": the plugin would make a user for `requestSignUp: true` (`spike.md` finding on the resolver). The first failing check gives the code.
// No TenantContext: it runs inside `/api/auth/*` (like `isBreakGlassOwner`). Kysely reads only.
export async function resolveSsoMember(db: Db | Transaction<DB>, identity: SsoIdentity): Promise<SsoResolution> {
  const provider = await getSsoProviderByProviderId(db, identity.providerId);
  if (!provider) return reject("no_provider", null);
  const orgId = provider.orgId;
  if (!(await isFeatureOn(db, { orgId }, "sso_sign_in"))) return reject("sso_off", orgId);

  const linkedUserId = await getSsoLinkUserId(db, identity.providerId, identity.subject);
  if (linkedUserId !== undefined) {
    // A changed IdP e-mail is accepted: the link is the proof. The membership rule still holds.
    if ((await oldestOrgIdOf(db, linkedUserId)) !== orgId) return reject("not_a_member", orgId);
    return { kind: "link", userId: linkedUserId, orgId, firstLink: false };
  }

  if (identity.emailVerified === false) return reject("email_unverified", orgId);
  const email = identity.email.trim().toLowerCase();
  if (!hasMailDomain(email, provider.domain)) return reject("domain_mismatch", orgId);
  if (provider.issuer === GOOGLE_ISSUER && identity.hostedDomain?.toLowerCase() !== provider.domain) {
    return reject("domain_mismatch", orgId);
  }

  const userId = await getUserIdByEmail(db, email);
  // Cold review N5: the provider's organization must be the oldest membership, so another organization's IdP never opens this tenant.
  if (userId === undefined || (await oldestOrgIdOf(db, userId)) !== orgId) return reject("not_a_member", orgId);
  if (await hasOtherSsoAccount(db, userId, identity.providerId, identity.subject)) {
    return reject("identity_mismatch", orgId);
  }
  return { kind: "link", userId, orgId, firstLink: true };
}
