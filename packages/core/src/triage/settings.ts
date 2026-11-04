import { z } from "zod";

import type { Category } from "./categories";

export const DEFAULT_THRESHOLD = 0.7;

export const toolSwitchesSchema = z.object({
  move: z.boolean().default(false),
  mark_read: z.boolean().default(false),
  flag: z.boolean().default(false),
  create_draft: z.boolean().default(false),
  move_unsure: z.boolean().default(false),
});
export type ToolSwitches = z.infer<typeof toolSwitchesSchema>;

export function parseToolSwitches(json: unknown): ToolSwitches {
  return toolSwitchesSchema.parse(json);
}

export const categoryPolicySchema = z.record(
  z.string(),
  z
    .object({
      auto: z.boolean().default(false),
      threshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
    })
    .partial()
);
export type CategoryPolicy = z.infer<typeof categoryPolicySchema>;

export function parseCategoryPolicy(json: unknown): CategoryPolicy {
  return categoryPolicySchema.parse(json);
}

export function thresholdFor(policy: CategoryPolicy, category: Category): number {
  return policy[category]?.threshold ?? DEFAULT_THRESHOLD;
}

export function autoFor(policy: CategoryPolicy, category: Category): boolean {
  return policy[category]?.auto ?? false;
}
