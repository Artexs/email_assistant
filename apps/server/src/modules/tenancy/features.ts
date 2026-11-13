import { featureFlags, featureKeys, resolveFeature, type FeatureKey, type FeatureSource } from "@ea/core";

import { featuresOffFromEnv } from "../../platform/config";
import type { DB, Db, TenantContext } from "../../platform/db";

import { getOrgFeature, listOrgFeatureRows } from "./repo";

import type { Transaction } from "kysely";

// The process kill list (FEATURES_OFF, D9). null = not set yet: the first read parses process.env once.
let off: ReadonlySet<FeatureKey> | null = null;

/** Sets the kill list explicitly (main.ts, org:flag, tests). */
export function configureFeatures(input: { off: readonly FeatureKey[] }): void {
  off = new Set(input.off);
}

/** The kill list. Without an earlier configureFeatures call it reads FEATURES_OFF from the env once. A bad key throws ConfigError. */
export function featureSettings(): { off: ReadonlySet<FeatureKey> } {
  off ??= new Set(featuresOffFromEnv(process.env));
  return { off };
}

/** Order: FEATURES_OFF → the organization row → the registry default. A killed flag makes no query. */
export async function isFeatureOn(db: Db | Transaction<DB>, ctx: TenantContext, flag: FeatureKey): Promise<boolean> {
  const killed = featureSettings().off.has(flag);
  if (killed) return resolveFeature({ defaultOn: featureFlags[flag].default, killed, row: undefined }).enabled;
  const row = await getOrgFeature(db, ctx, flag);
  return resolveFeature({ defaultOn: featureFlags[flag].default, killed, row }).enabled;
}

/** Every registry key in registry order with its effective value and source. Rows with an unknown key are skipped. */
export async function featureStates(
  db: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<{ flag: FeatureKey; enabled: boolean; source: FeatureSource }[]> {
  const { off: killedKeys } = featureSettings();
  const rows = new Map((await listOrgFeatureRows(db, ctx)).map((row) => [row.flag, row.enabled]));
  return featureKeys.map((flag) => ({
    flag,
    ...resolveFeature({ defaultOn: featureFlags[flag].default, killed: killedKeys.has(flag), row: rows.get(flag) }),
  }));
}
