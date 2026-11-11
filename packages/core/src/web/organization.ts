import { DIGEST_TIME_PATTERN, MAX_DIGEST_TIMES } from "../digest/schedule";

import { z } from "./zod";

export { MAX_DIGEST_TIMES } from "../digest/schedule";

export const STYLE_TEXT_MAX = 500;
const STYLE_TEXT_INPUT_MAX = 2000;

export function normalizeStyleText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

// Control characters except \n (0x0A) and \t (0x09).
// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u0008\u000B-\u001F\u007F]/;

// The messages are i18n keys: the browser maps them with `t()`.
export const styleTextSchema = z
  .string()
  .max(STYLE_TEXT_INPUT_MAX, "style_too_long")
  .transform(normalizeStyleText)
  .pipe(
    z
      .string()
      .max(STYLE_TEXT_MAX, "style_too_long")
      .refine((value) => !controlChars.test(value), "style_bad_char")
  )
  .transform((value) => (value === "" ? null : value));

export const organizationPatchSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64).optional(),
    styleText: styleTextSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { path: [], message: "empty_patch" });
export type OrganizationPatch = z.infer<typeof organizationPatchSchema>;

export const organizationViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  styleText: z.string().nullable(),
  retentionDays: z.number().int().positive(),
});

export const organizationSettingsSchema = organizationViewSchema.extend({ timezones: z.array(z.string()) });

export const digestTimesBodySchema = z
  .object({
    times: z.array(z.string().regex(DIGEST_TIME_PATTERN, "time_invalid")).max(MAX_DIGEST_TIMES, "times_too_many"),
  })
  .refine((value) => new Set(value.times).size === value.times.length, {
    path: ["times"],
    message: "times_duplicate",
  });

export const digestTimesSchema = z.object({ times: z.array(z.string()) });
