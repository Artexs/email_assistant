import { z } from "zod";

import type { Category, MailboxMode } from "./categories";

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

export const toolSwitchNames = [
  "move",
  "mark_read",
  "flag",
  "create_draft",
  "move_unsure",
] as const satisfies readonly (keyof ToolSwitches)[];

// P3: the switches that the mode change to `assist` sets. `create_draft` stays as it is (S4).
export const ASSIST_DEFAULT_SWITCHES: Partial<ToolSwitches> = {
  move: true,
  mark_read: true,
  flag: true,
  move_unsure: false,
};

export interface SettingsSnapshot {
  mode: MailboxMode;
  toolSwitches: ToolSwitches;
  categoryPolicy: CategoryPolicy;
  movesSupported: boolean;
}

const POLICY_CATEGORIES = ["urgent", "needs_reply", "info", "notification", "spam"] as const;

// Plain lines for the CLI table. Ids, booleans and numbers only.
export function describeSettings(settings: SettingsSnapshot): string[] {
  const onOff = (value: boolean) => (value ? "on" : "off");
  return [
    `mode: ${settings.mode}`,
    ...toolSwitchNames.map((name) => `switch ${name}: ${onOff(settings.toolSwitches[name])}`),
    ...POLICY_CATEGORIES.map(
      (category) =>
        `auto ${category}: ${onOff(autoFor(settings.categoryPolicy, category))}, threshold ${thresholdFor(settings.categoryPolicy, category)}`
    ),
    `moves supported: ${onOff(settings.movesSupported)}`,
  ];
}
