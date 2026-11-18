import { featureFlags, resolveFeature } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";

import { featureSettings } from "./features";
import { existsProvedSsoProviderWithFlagOn } from "./repo";

const FLAG = "sso_sign_in";

// True when company sign-in can work for somebody: one provider with a proved domain, and its organization has the flag
// `sso_sign_in` on (row, else default; the kill list wins). No tenant scope and no session: the login page asks before
// anybody signs in. The answer is one bit for every caller; it never depends on an address.
// A killed flag makes no query. `resolveFeature` keeps one rule for the flag order (FEATURES_OFF, row, default).
export async function anySsoUsable(db: Db | Transaction<DB>): Promise<boolean> {
  const killed = featureSettings().off.has(FLAG);
  const defaultOn = featureFlags[FLAG].default;
  if (killed) return resolveFeature({ defaultOn, killed, row: undefined }).enabled;
  return existsProvedSsoProviderWithFlagOn(db, FLAG, defaultOn);
}
