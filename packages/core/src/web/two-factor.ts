import { z } from "./zod";

// The roles that need the second factor. The order is the order of the answer.
export const twoFactorRequirements = ["operator", "break_glass"] as const;

// The own TOTP state of the signed-in user. It holds a count of backup codes, never a code.
export const twoFactorStatusSchema = z.strictObject({
  enabled: z.boolean(),
  backupCodesLeft: z.number().int().min(0).nullable(),
  requiredBy: z.array(z.enum(twoFactorRequirements)),
});

export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

export const FEW_BACKUP_CODES = 3; // the Account card warns at this count or fewer
