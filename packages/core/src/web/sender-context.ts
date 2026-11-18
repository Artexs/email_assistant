import { z } from "zod";

import { suggestionKinds, suggestionReasonSchema, suggestionScopes } from "../contacts/types";
import { senderRelations } from "../triage/sender-history";

// Counts only: no text field (ADR 0034, PD-106).
export const senderLineSchema = z
  .object({
    relation: z.enum(senderRelations),
    received: z.number().int().min(0),
    answered: z.number().int().min(0),
    userMailsTo: z.number().int().min(0),
    lastSeenDaysAgo: z.number().int().min(0).nullable(),
    days: z.literal(90),
  })
  .strict();
export type SenderLine = z.infer<typeof senderLineSchema>;

// An open suggestion as the Rules card shows it. `pattern` is the address or `@domain`; it is null only after the end, so never here.
export const suggestionItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(suggestionKinds),
    scope: z.enum(suggestionScopes),
    pattern: z.string().min(1),
    reason: suggestionReasonSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type SuggestionItem = z.infer<typeof suggestionItemSchema>;
