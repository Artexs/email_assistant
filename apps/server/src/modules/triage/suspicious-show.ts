import type { SuspiciousReason } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { isFeatureOn } from "../tenancy";

import { suspiciousReasonsOf } from "./suspicious-repo";

// The reasons that a notice or the panel shows (F109 stage 04): the same map as `suspiciousReasonsOf`, but empty while the flag
// `suspicious_mail` is off. The flag decides only what the user sees; a draft block reads `suspiciousReasonsOf` and ignores it.
export async function suspiciousReasonsToShow(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, SuspiciousReason[]>> {
  if (emailIds.length === 0 || !(await isFeatureOn(db, ctx, "suspicious_mail"))) return new Map();
  return suspiciousReasonsOf(db, ctx, emailIds);
}
