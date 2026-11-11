import { isValidSenderPattern, normalizeSenderPattern, senderRuleKinds } from "../triage/rules";

import { z } from "./zod";

export { senderRuleKinds, type SenderRuleKind } from "../triage/rules";

// The messages are i18n keys: the browser maps them with `t()`.
const patternSchema = z
  .string()
  .max(254, "pattern_invalid")
  .transform(normalizeSenderPattern)
  .refine(isValidSenderPattern, "pattern_invalid");

export const ruleBodySchema = z.object({
  kind: z.enum(senderRuleKinds),
  pattern: patternSchema,
  mailboxId: z.uuid().optional(),
});
export type RuleBody = z.infer<typeof ruleBodySchema>;

export const ruleViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(senderRuleKinds),
  pattern: z.string(),
  mailboxId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type RuleView = z.infer<typeof ruleViewSchema>;

export const ruleListSchema = z.array(ruleViewSchema);

export const rulesQuerySchema = z.object({ mailboxId: z.uuid().optional() });
