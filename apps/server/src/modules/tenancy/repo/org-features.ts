import { isFeatureKey, type FeatureKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

// Feature flags (ADR 0027). A missing row means the registry default: the caller decides (resolveFeature).
export async function getOrgFeature(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  flag: FeatureKey
): Promise<boolean | undefined> {
  const row = await db
    .selectFrom("org_features")
    .select("enabled")
    .where("org_id", "=", ctx.orgId)
    .where("flag", "=", flag)
    .executeTakeFirst();
  return row?.enabled;
}

export async function listOrgFeatureRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<{ flag: string; enabled: boolean; set_by: string; set_at: Date }[]> {
  return db
    .selectFrom("org_features")
    .select(["flag", "enabled", "set_by", "set_at"])
    .where("org_id", "=", ctx.orgId)
    .orderBy("flag")
    .execute();
}

export async function upsertOrgFeature(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { flag: FeatureKey; enabled: boolean; setBy: string; setAt: Date }
): Promise<void> {
  // The type is no guard at run time: a cast can pass any string.
  if (!isFeatureKey(input.flag)) throw new Error(`unknown feature flag: ${input.flag}`);
  await db
    .insertInto("org_features")
    .values({ org_id: ctx.orgId, flag: input.flag, enabled: input.enabled, set_by: input.setBy, set_at: input.setAt })
    .onConflict((oc) =>
      oc.columns(["org_id", "flag"]).doUpdateSet({ enabled: input.enabled, set_by: input.setBy, set_at: input.setAt })
    )
    .execute();
}

// No TenantContext: listed in docs/code-patterns.md. Only /api/operator/* calls it (F087).
export async function listOrgFeatureRowsOfAll(
  db: Db | Transaction<DB>
): Promise<{ org_id: string; flag: string; enabled: boolean }[]> {
  return db
    .selectFrom("org_features")
    .select(["org_id", "flag", "enabled"])
    .orderBy("org_id")
    .orderBy("flag")
    .execute();
}
