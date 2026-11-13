import { featureFlags, featureKeys, resolveFeature, type FeatureKey, type FeatureSource } from "@ea/core";
import type { OperatorFlagRow } from "@ea/core";
import type { Transaction } from "kysely";

import { featuresOffFromEnv } from "../../platform/config";
import type { DB, Db, TenantContext } from "../../platform/db";

import { getOrgFeature, listOrganizations, listOrgFeatureRows, listOrgFeatureRowsOfAll } from "./repo";

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

/** D18: every organization (listOrganizations order) × every registry key (registry order), effective values. Rows with an unknown key are skipped. */
export async function featureStatesOfAll(db: Db | Transaction<DB>): Promise<OperatorFlagRow[]> {
  const { off: killedKeys } = featureSettings();
  const [orgs, rows] = await Promise.all([listOrganizations(db), listOrgFeatureRowsOfAll(db)]);
  const byOrg = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const flags = byOrg.get(row.org_id) ?? new Map<string, boolean>();
    flags.set(row.flag, row.enabled);
    byOrg.set(row.org_id, flags);
  }
  return orgs.flatMap((org) =>
    featureKeys.map((flag) => ({
      orgId: org.id,
      flag,
      enabled: resolveFeature({
        defaultOn: featureFlags[flag].default,
        killed: killedKeys.has(flag),
        row: byOrg.get(org.id)?.get(flag),
      }).enabled,
    }))
  );
}
