import { z } from "./zod";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// The messages are i18n keys: the browser maps them with `t()`.
export const passwordSchema = z.string().min(PASSWORD_MIN, "password_too_short").max(PASSWORD_MAX, "password_too_long");

export const loginFormSchema = z.object({
  email: z.email("email_invalid"),
  password: z.string().min(1, "password_required"),
});

export const setPasswordFormSchema = z
  .object({ email: z.email("email_invalid"), password: passwordSchema, repeat: z.string() })
  .refine((v) => v.password === v.repeat, { path: ["repeat"], message: "passwords_differ" });

export function fieldErrors(result: z.ZodSafeParseResult<unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (result.success) return errors;
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}
