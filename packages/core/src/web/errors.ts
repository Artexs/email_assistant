import { z } from "./zod";

export const apiErrorCodes = [
  "validation",
  "too_large",
  "confirm_mismatch",
  "unauthorized",
  "owner_only",
  "no_organization",
  "bad_origin",
  "not_found",
  "mailbox_exists",
  "rule_exists",
  "wrong_status",
  "no_go",
  "telegram_off",
  "mail_login_failed",
  "mail_unreachable",
  "host_not_allowed",
  "telegram_unreachable",
  "internal",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
