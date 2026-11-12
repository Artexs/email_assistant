import { membershipRoleSchema } from "../tenancy";

import { onboardingSchema } from "./onboarding";
import { z } from "./zod";

export const scopeKinds = ["off", "synthetic", "self", "all"] as const;
export const scopeReasons = [
  "env_off",
  "synthetic_only",
  "test_addresses_only",
  "all_mailboxes",
  "by_mode",
  "after_approval",
] as const;

export const scopeInfoSchema = z.object({ kind: z.enum(scopeKinds), reason: z.enum(scopeReasons) });
export type ScopeInfo = z.infer<typeof scopeInfoSchema>;

const allReasons = { triage: "all_mailboxes", actions: "by_mode", send: "after_approval" } as const;

export function scopeInfoOf(
  scope: "triage" | "actions" | "send",
  kind: "off" | "synthetic" | "self" | "all"
): ScopeInfo {
  switch (kind) {
    case "off":
      return { kind, reason: "env_off" };
    case "synthetic":
      return { kind, reason: "synthetic_only" };
    case "self":
      return { kind, reason: "test_addresses_only" };
    case "all":
      return { kind, reason: allReasons[scope] };
  }
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
