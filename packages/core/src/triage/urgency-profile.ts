import { z } from "zod";

// The executive's urgency context besides VIP people (VIP people are sender rules of kind `vip`).
// One shape for the stored profile, the classifier prompt and the editor.
export const URGENCY_MAX_ITEMS = 20;

export const urgencyTopicSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    keywords: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  })
  .strict();

export const urgencyDeadlineSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    due: z.iso.date(),
  })
  .strict();

export const urgencyProfileSchema = z
  .object({
    topics: z.array(urgencyTopicSchema).max(URGENCY_MAX_ITEMS).default([]),
    deadlines: z.array(urgencyDeadlineSchema).max(URGENCY_MAX_ITEMS).default([]),
  })
  .strict();
export type UrgencyProfile = z.infer<typeof urgencyProfileSchema>;

export const urgencySources = ["text", "vip", "context"] as const;
export type UrgencySource = (typeof urgencySources)[number];
