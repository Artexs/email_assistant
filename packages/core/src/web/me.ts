import { membershipRoleSchema } from "../tenancy";

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
  telegram: z.null(), // S5b: z.object({ linked, botUsername }).nullable()
  onboarding: z.null(), // S5b: the D15 object, nullable
  scopes: z.object({ triage: scopeInfoSchema, actions: scopeInfoSchema, send: scopeInfoSchema }),
  mailboxCount: z.number().int().min(0),
  mailboxesInAuthError: z.number().int().min(0),
});
export type Me = z.infer<typeof meSchema>;
