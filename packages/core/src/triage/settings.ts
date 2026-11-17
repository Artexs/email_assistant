import { z } from "zod";

import { type EvidenceKey, evidenceKeySchema, sameKey } from "../trust/key";

import type { Category, MailboxMode } from "./categories";
import { barCategories } from "./metrics";

export const DEFAULT_THRESHOLD = 0.7;

export const toolSwitchesSchema = z.object({
  move: z.boolean().default(false),
  mark_read: z.boolean().default(false),
  flag: z.boolean().default(false),
  create_draft: z.boolean().default(false),
  move_unsure: z.boolean().default(false),
  // Open loops (E5b): the daily chaser plans a follow-up card for a waiting loop. Off until the owner turns it on; every
  // follow-up still waits for a tap. It sits in the schema so that a settings write does not drop the stored key. Only a JSON
  // `true` is on: another stored value reads as off and does not fail the parse of the other switches (triage reads them all).
  auto_follow_up: z.boolean().default(false).catch(false),
});
export type ToolSwitches = z.infer<typeof toolSwitchesSchema>;
// What a writer may pass: a key that is left out takes its default.
export type ToolSwitchesInput = z.input<typeof toolSwitchesSchema>;
// The switches of the mailbox tools: what the triage policy reads. `auto_follow_up` belongs to the open loops.
export type MailToolSwitches = Omit<ToolSwitches, "auto_follow_up">;

export function parseToolSwitches(json: unknown): ToolSwitches {
  return toolSwitchesSchema.parse(json);
}

// Who turned `auto` on, and under which model setup (ADR 0028). `at` is an ISO instant: it is the `granted_at` of a trip.
export const categoryGrantBy = ["evidence", "forced", "recommended", "regate", "legacy", "real_labels"] as const;
export type CategoryGrantBy = (typeof categoryGrantBy)[number];

export const categoryGrantSchema = z.object({
  key: evidenceKeySchema,
  by: z.enum(categoryGrantBy),
  at: z.string(),
});
export type CategoryGrant = z.infer<typeof categoryGrantSchema>;

export const categoryPolicySchema = z.record(
  z.string(),
  z
    .object({
      auto: z.boolean().default(false),
      threshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
      // Absent: `auto` was set before the evidence ladder (counts as matching until the re-gate stamps it).
      grant: categoryGrantSchema,
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

/**
 * `auto` that triage may use now: `auto` is on and its grant (when there is one) was made under the running key.
 * A key mismatch is `auto` off at once, with no job in between (ADR 0028). No grant: before the evidence ladder, counts as matching.
 */
export function effectiveAutoFor(policy: CategoryPolicy, category: Category, runningKey: EvidenceKey): boolean {
  const entry = policy[category];
  if (entry?.auto !== true) return false;
  return entry.grant === undefined || sameKey(entry.grant.key, runningKey);
}

export const toolSwitchNames = [
  "move",
  "mark_read",
  "flag",
  "create_draft",
  "move_unsure",
] as const satisfies readonly (keyof ToolSwitches)[];

// The switches that exist only while the flag `open_loops` is on.
export const loopSwitchNames = ["auto_follow_up"] as const satisfies readonly (keyof ToolSwitches)[];

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

// Plain lines for the CLI table. Ids, booleans and numbers only.
export function describeSettings(settings: SettingsSnapshot): string[] {
  const onOff = (value: boolean) => (value ? "on" : "off");
  return [
    `mode: ${settings.mode}`,
    ...toolSwitchNames.map((name) => `switch ${name}: ${onOff(settings.toolSwitches[name])}`),
    ...barCategories.map(
      (category) =>
        `auto ${category}: ${onOff(autoFor(settings.categoryPolicy, category))}, threshold ${thresholdFor(settings.categoryPolicy, category)}`
    ),
    `moves supported: ${onOff(settings.movesSupported)}`,
  ];
}
