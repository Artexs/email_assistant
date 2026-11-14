import { presetKeys, smtpSecurities, type PresetKey, type SmtpSecurity } from "../mail/providers";
import { mailboxModes } from "../triage/categories";

import { z } from "./zod";

const secretKindSchema = z.enum(["password", "app_password"]);
const addressSchema = z.email({ pattern: z.regexes.html5Email }).max(254);
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:-]+$/);
const portSchema = z.number().int().min(1).max(65535);

const serverFieldNames = ["imapHost", "imapPort", "smtpHost", "smtpPort"] as const;

export interface ConnectMailboxBody {
  address: string;
  password: string;
  secretKind: "password" | "app_password";
  preset?: PresetKey;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: SmtpSecurity;
}

export const connectMailboxBodySchema: z.ZodType<ConnectMailboxBody> = z
  .object({
    address: addressSchema,
    password: z.string().min(1).max(512),
    secretKind: secretKindSchema,
    preset: z.enum(presetKeys).optional(),
    imapHost: hostSchema.optional(),
    imapPort: portSchema.optional(),
    smtpHost: hostSchema.optional(),
    smtpPort: portSchema.optional(),
    smtpSecurity: z.enum(smtpSecurities).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.preset !== undefined && body.smtpSecurity !== undefined) {
      ctx.addIssue({ code: "custom", message: "not_with_preset", path: ["smtpSecurity"] });
    }
    for (const field of serverFieldNames) {
      const present = body[field] !== undefined;
      if (body.preset !== undefined && present) {
        ctx.addIssue({ code: "custom", message: "not_with_preset", path: [field] });
      } else if (body.preset === undefined && !present) {
        ctx.addIssue({ code: "custom", message: "required", path: [field] });
      }
    }
  });

export const mailboxPasswordBodySchema = z.object({
  password: z.string().min(1).max(512),
  secretKind: secretKindSchema,
});

export const removeMailboxBodySchema = z.object({
  confirmAddress: z.string().min(1).max(254),
});

export const mailboxStatuses = ["active", "paused", "auth_error", "host_blocked"] as const;
export type MailboxStatus = (typeof mailboxStatuses)[number];
export const badgeStates = ["on", "off", "synthetic", "self"] as const;
export const badgeReasons = [
  "env_off",
  "synthetic_only",
  "test_addresses_only",
  "all_mailboxes",
  "by_mode",
  "after_approval",
] as const;

export const scopeBadgeSchema = z.object({ state: z.enum(badgeStates), reason: z.enum(badgeReasons) });
export type ScopeBadge = z.infer<typeof scopeBadgeSchema>;

export interface ScopeEnv {
  triage: "off" | "synthetic" | "all";
  actions: "off" | "synthetic" | "all";
  send: "off" | "self" | "all";
}

export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const allReasons = { triage: "all_mailboxes", actions: "by_mode", send: "after_approval" } as const;

function badgeOf(scope: keyof typeof allReasons, kind: "off" | "synthetic" | "self" | "all"): ScopeBadge {
  if (kind === "off") return { state: "off", reason: "env_off" };
  if (kind === "synthetic") return { state: "synthetic", reason: "synthetic_only" };
  if (kind === "self") return { state: "self", reason: "test_addresses_only" };
  return { state: "on", reason: allReasons[scope] };
}

export function mailboxScopeBadges(env: ScopeEnv): { triage: ScopeBadge; actions: ScopeBadge; send: ScopeBadge } {
  return {
    triage: badgeOf("triage", env.triage),
    actions: badgeOf("actions", env.actions),
    send: badgeOf("send", env.send),
  };
}

export const mailboxViewSchema = z.object({
  id: z.uuid(),
  address: z.string(),
  status: z.enum(mailboxStatuses),
  statusChangedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  lastSyncedAt: z.iso.datetime().nullable(),
  mode: z.enum(mailboxModes).nullable(),
  movesSupported: z.boolean(),
  secretKind: secretKindSchema,
  scopes: z.object({ triage: scopeBadgeSchema, actions: scopeBadgeSchema, send: scopeBadgeSchema }),
});
export type MailboxView = z.infer<typeof mailboxViewSchema>;

export const mailboxListSchema = z.array(mailboxViewSchema);

export const connectResultSchema = z.object({
  id: z.uuid(),
  address: z.string(),
  status: z.enum(mailboxStatuses),
  capabilities: z.object({ move: z.boolean(), uidplus: z.boolean(), idle: z.boolean() }),
});
