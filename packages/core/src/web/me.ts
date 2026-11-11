import { membershipRoleSchema } from "../tenancy";

import { onboardingSchema } from "./onboarding";
import { z } from "./zod";

export const scopeKinds = ["off", "synthetic", "self", "all"] as const;
export const scopeReasons = ["env_off", "synthetic_only", "test_addresses_only", "test_mailbox_only"] as const;

export const scopeInfoSchema = z.object({ kind: z.enum(scopeKinds), reason: z.enum(scopeReasons) });
export type ScopeInfo = z.infer<typeof scopeInfoSchema>;

const reasonOfKind = {
  off: "env_off",
  synthetic: "synthetic_only",
  self: "test_addresses_only",
  all: "test_mailbox_only",
} as const;

export function scopeInfoOf(kind: "off" | "synthetic" | "self" | "all"): ScopeInfo {
  return { kind, reason: reasonOfKind[kind] };
}

export const meSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string() }),
  organization: z.object({ id: z.uuid(), name: z.string(), timezone: z.string() }),
  role: membershipRoleSchema,
  telegram: z.object({ available: z.boolean(), linked: z.boolean(), botUsername: z.string().nullable() }),
  onboarding: onboardingSchema,
  scopes: z.object({ triage: scopeInfoSchema, actions: scopeInfoSchema, send: scopeInfoSchema }),
  mailboxCount: z.number().int().min(0),
  mailboxesInAuthError: z.number().int().min(0),
  digestTimes: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;
