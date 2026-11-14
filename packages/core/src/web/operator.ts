import type { FeatureKey } from "../features";
import { orgPlanSchema } from "../tenancy";

import { z } from "./zod";

// GET /api/operator/flags (F087, D18): ids, keys and booleans only.
export interface OperatorFlagRow {
  orgId: string;
  flag: FeatureKey;
  enabled: boolean;
}

export interface OperatorFlags {
  rows: OperatorFlagRow[];
}

// GET /api/operator/orgs (F099 D15): ids, codes, counts and dates only. No name, address or text; strict objects keep it so.
export const operatorLlmTodaySchema = z.strictObject({
  since: z.iso.datetime(), // the quota day start
  calls: z.number().int().min(0),
  costUsd: z.number().min(0), // priced models only
  unpricedCalls: z.number().int().min(0),
});

export const operatorOrgRowSchema = z.strictObject({
  orgId: z.uuid(),
  plan: orgPlanSchema,
  trialEndsAt: z.iso.datetime().nullable(),
  resumedAt: z.iso.datetime().nullable(),
  maxMailboxes: z.number().int().min(0),
  members: z.number().int().min(0),
  linkedChats: z.number().int().min(0),
  mailboxes: z.strictObject({
    total: z.number().int(),
    active: z.number().int(),
    paused: z.number().int(),
    authError: z.number().int(),
  }),
  lastSyncAt: z.iso.datetime().nullable(), // newest mailboxes.last_synced_at
  failures24h: z.strictObject({ sends: z.number().int(), outbox: z.number().int() }),
  llmToday: operatorLlmTodaySchema,
});

export const operatorOrgListSchema = z.strictObject({ orgs: z.array(operatorOrgRowSchema), at: z.iso.datetime() });

export type OperatorOrgRow = z.infer<typeof operatorOrgRowSchema>;
export type OperatorOrgList = z.infer<typeof operatorOrgListSchema>;
