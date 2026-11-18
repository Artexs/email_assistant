import type { FeatureKey } from "../features";
import { orgPlanSchema } from "../tenancy";

import { mailboxStatuses } from "./mailboxes";
import { z } from "./zod";

// GET /api/operator/flags: ids, keys and booleans only.
export interface OperatorFlagRow {
  orgId: string;
  flag: FeatureKey;
  enabled: boolean;
}

export interface OperatorFlags {
  rows: OperatorFlagRow[];
}

// GET /api/operator/orgs: ids, codes, counts and dates only. No name, address or text; strict objects keep it so.
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
    hostBlocked: z.number().int(),
  }),
  lastSyncAt: z.iso.datetime().nullable(), // newest mailboxes.last_synced_at
  failures24h: z.strictObject({ sends: z.number().int(), outbox: z.number().int() }),
  llmToday: operatorLlmTodaySchema,
});

export const operatorOrgListSchema = z.strictObject({ orgs: z.array(operatorOrgRowSchema), at: z.iso.datetime() });

export type OperatorOrgRow = z.infer<typeof operatorOrgRowSchema>;
export type OperatorOrgList = z.infer<typeof operatorOrgListSchema>;

// GET /api/operator/orgs/:orgId: the same rule. A mailbox has an id, a state and times, no address.
export const operatorNoticesQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });

export const operatorOrgDetailSchema = z.strictObject({
  orgId: z.uuid(),
  plan: orgPlanSchema,
  trialEndsAt: z.iso.datetime().nullable(),
  resumedAt: z.iso.datetime().nullable(),
  maxMailboxes: z.number().int().min(0),
  mailboxes: z.array(
    z.strictObject({
      mailboxId: z.uuid(),
      status: z.enum(mailboxStatuses),
      statusChangedAt: z.iso.datetime(),
      lastSyncedAt: z.iso.datetime().nullable(),
    })
  ),
  lastRuns: z.strictObject({
    sync: z.iso.datetime().nullable(),
    triage: z.iso.datetime().nullable(),
    digest: z.iso.datetime().nullable(),
    send: z.iso.datetime().nullable(),
    notice: z.iso.datetime().nullable(),
  }),
  failures24h: z.strictObject({ sends: z.number().int(), outbox: z.number().int() }),
  llmToday: operatorLlmTodaySchema,
  flags: z.array(z.strictObject({ flag: z.string(), enabled: z.boolean(), source: z.enum(["env", "row", "default"]) })),
  // The domain is the organization's own; no issuer URL, client id, secret or member id.
  sso: z
    .strictObject({
      domain: z.string(),
      proof: z.enum(["dns", "attested"]).nullable(),
      required: z.boolean(),
      linkedMembers: z.number().int(),
      breakGlassReady: z.boolean(),
    })
    .nullable(),
  at: z.iso.datetime(),
});

// GET /api/operator/notices: the operator notices of all organizations, newest first.
export const operatorNoticesSchema = z.strictObject({
  notices: z.array(z.strictObject({ orgId: z.uuid(), kind: z.string(), key: z.string(), at: z.iso.datetime() })),
  since: z.iso.datetime(),
});

export type OperatorOrgDetail = z.infer<typeof operatorOrgDetailSchema>;
export type OperatorNotices = z.infer<typeof operatorNoticesSchema>;

// POST /api/operator/orgs/:orgId/plan and /flags: the bodies of the CLIs `org:plan` and `org:flag`.
export const operatorPlanBodySchema = z.strictObject({
  plan: orgPlanSchema.optional(),
  trialDays: z.number().int().min(1).max(365).optional(),
  maxMailboxes: z.number().int().min(0).max(100).optional(),
});

export const operatorFlagBodySchema = z.strictObject({
  flag: z.string().min(1).max(40),
  enabled: z.boolean(),
});

export const operatorPlanResultSchema = z.strictObject({
  result: z.enum(["changed", "unchanged"]),
  plan: orgPlanSchema,
  trialEndsAt: z.iso.datetime().nullable(),
  maxMailboxes: z.number().int().min(0),
  resumedAt: z.iso.datetime().nullable(),
  cancelledMessages: z.number().int().min(0), // 0 when unchanged
  expiredSends: z.number().int().min(0), // 0 when unchanged
});

export const operatorFlagResultSchema = z.strictObject({
  result: z.enum(["changed", "unchanged"]),
  flag: z.string(),
  enabled: z.boolean(),
  // The flag `sso_sign_in` went off in an organization that requires SSO; only its break-glass owner can sign in.
  warning: z.literal("sso_required_on").optional(),
});

export type OperatorPlanBody = z.infer<typeof operatorPlanBodySchema>;
export type OperatorFlagBody = z.infer<typeof operatorFlagBodySchema>;
export type OperatorPlanResult = z.infer<typeof operatorPlanResultSchema>;
export type OperatorFlagResult = z.infer<typeof operatorFlagResultSchema>;
