import { DIGEST_TIME_PATTERN, MAX_DIGEST_TIMES } from "../digest/schedule";

import { z } from "./zod";

export { MAX_DIGEST_TIMES } from "../digest/schedule";

export const organizationPatchSchema = z
  .strictObject({
    timezone: z.string().trim().min(1, "timezone_invalid").max(64, "timezone_invalid").optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { path: [], message: "empty_patch" });
export type OrganizationPatch = z.infer<typeof organizationPatchSchema>;

export const organizationViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  retentionDays: z.number().int().positive(),
});

export type OrganizationView = z.infer<typeof organizationViewSchema>;

export const organizationSettingsSchema = organizationViewSchema.extend({
  timezones: z.array(z.string()),
  // The owner's lock of the Telegram detail level `minimal`. Absent while the flag `telegram_minimal` is off for the organization.
  telegramMinimalLocked: z.boolean().optional(),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const digestTimesBodySchema = z
  .object({
    times: z.array(z.string().regex(DIGEST_TIME_PATTERN, "time_invalid")).max(MAX_DIGEST_TIMES, "times_too_many"),
  })
  .refine((value) => new Set(value.times).size === value.times.length, {
    path: ["times"],
    message: "times_duplicate",
  });

export const digestTimesSchema = z.object({ times: z.array(z.string()) });

// DELETE /api/organization: the password of the signed-in owner and the typed organization name.
// The name is matched on the server (`orgNameMatches`). Neither value goes to a log line, an error text or an audit row.
export const orgDeleteRequestSchema = z.object({
  password: z.string().min(1).max(128),
  confirmName: z.string().min(1).max(200),
});
export type OrgDeleteRequest = z.infer<typeof orgDeleteRequestSchema>;

// The mailbox addresses of the deleted organization, sorted: the owner changes these mailbox passwords.
export const orgDeleteResponseSchema = z.object({ mailboxAddresses: z.array(z.string()) });
export type OrgDeleteResponse = z.infer<typeof orgDeleteResponseSchema>;
