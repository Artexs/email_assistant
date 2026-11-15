import type { Transaction } from "kysely";

import { endPasswordSessionsAndChallenges } from "../../platform/auth-sessions-end";
import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { isFeatureOn } from "./features";
import {
  hasUsableBreakGlass,
  isPasswordSignInRefused,
  listMemberships,
  lockOrganization,
  lockSsoProvider,
  readSsoRequired,
  setSsoRequiredFlag,
  strandsOtherBreakGlass,
} from "./repo";

const log = createLog("tenancy");

export type SsoRequireRefusal = "no_provider" | "unproved" | "flag_off" | "no_break_glass" | "off_domain_members";

export type SetSsoRequiredResult =
  | { kind: "changed" | "unchanged" }
  | { kind: "refused"; reasons: SsoRequireRefusal[]; userIds: string[] };

// The e-mail has the provider domain after the last `@`; a subdomain does not match (one domain per provider). Like `resolveSsoMember`.
function hasDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1) === domain;
}

// "SSO required" (ADR 0026 point 6). On: one transaction with the organization locked, every prerequisite
// checked and every failure returned, so the operator fixes all of them at once. Then the flag, and the end of the
// password sessions and of the pending two-factor challenges of every member that the rule now refuses: neither may
// outlive the rule. Off: always allowed (the operator's way to reopen passwords).
export async function setSsoRequired(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { required: boolean; actor: string; now: Date }
): Promise<SetSsoRequiredResult> {
  const run = async (trx: Transaction<DB>): Promise<SetSsoRequiredResult> => {
    if (!(await lockOrganization(trx, ctx))) {
      return input.required ? { kind: "refused", reasons: ["no_provider"], userIds: [] } : { kind: "unchanged" };
    }
    const current = (await readSsoRequired(trx, ctx)) ?? false;
    if (current === input.required) return { kind: "unchanged" };

    let sessionsEnded = 0;
    if (input.required) {
      const provider = await lockSsoProvider(trx, ctx);
      const reasons: SsoRequireRefusal[] = [];
      let offDomain: string[] = [];
      if (!provider) reasons.push("no_provider");
      else if (provider.domainProof === null) reasons.push("unproved");
      // A `FEATURES_OFF` kill counts as off (`isFeatureOn`).
      if (!(await isFeatureOn(trx, ctx, "sso_sign_in"))) reasons.push("flag_off");
      // No break-glass owner with TOTP, or one whom another organization's rule refuses, or this switch would refuse the
      // break-glass owner of another organization: in each case an organization loses its last password path.
      if (!(await hasUsableBreakGlass(trx, ctx)) || (await strandsOtherBreakGlass(trx, ctx))) {
        reasons.push("no_break_glass");
      }
      if (provider) {
        // The break-glass owner signs in with a password and may use any address.
        offDomain = (await listMemberships(trx, ctx))
          .filter((member) => !member.break_glass && !hasDomain(member.email.toLowerCase(), provider.domain))
          .map((member) => member.user_id);
        if (offDomain.length > 0) reasons.push("off_domain_members");
      }
      if (reasons.length > 0) return { kind: "refused", reasons, userIds: offDomain };

      await setSsoRequiredFlag(trx, ctx, true);
      // The rule is the one that refuses a sign-in (`isPasswordSignInRefused`), read after the flag is set.
      const refused: string[] = [];
      for (const member of await listMemberships(trx, ctx)) {
        if (await isPasswordSignInRefused(trx, member.user_id)) refused.push(member.user_id);
      }
      ({ sessionsEnded } = await endPasswordSessionsAndChallenges(trx, refused));
    } else {
      await setSsoRequiredFlag(trx, ctx, false);
    }

    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ssoRequiredChanged,
      data: { from: current, to: input.required, sessions_ended: sessionsEnded },
      at: input.now,
    });
    log.info("sso_required_changed", { org_id: ctx.orgId, code: input.required ? "on" : "off" });
    return { kind: "changed" };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
