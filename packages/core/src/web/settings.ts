import { syncFolderKeys, syncFolderRoles } from "../mail/sync-folders";
import { mailboxModes } from "../triage/categories";
import { barCategories } from "../triage/metrics";
import { toolSwitchNames } from "../triage/settings";

import { z } from "./zod";

export { barCategories, type BarCategory } from "../triage/metrics";
export { toolSwitchNames, ASSIST_DEFAULT_SWITCHES } from "../triage/settings";

export const GATE_BAR = 0.98;
export const GATE_MIN_KEPT = 30;

export const gateDecisions = ["go", "no-go", "no-go: too few"] as const;

export const gateViewSchema = z.object({
  decision: z.enum(gateDecisions),
  precision: z.number().nullable(),
  kept: z.number().int(),
  atConfidence: z.number(),
  threshold: z.number().nullable(),
});
export type GateView = z.infer<typeof gateViewSchema>;

export const categorySettingSchema = z.object({
  category: z.enum(barCategories),
  auto: z.boolean(),
  threshold: z.number().min(0).max(1),
  gate: gateViewSchema,
});

export const switchableSyncFolderKeys = ["offers", "social", "bills", "junk"] as const;
export type SwitchableSyncFolderKey = (typeof switchableSyncFolderKeys)[number];

export const syncFolderViewSchema = z.object({
  key: z.enum(syncFolderKeys),
  role: z.enum(syncFolderRoles),
  path: z.string(),
  enabled: z.boolean(),
});

const toolSwitchesViewSchema = z.strictObject(
  Object.fromEntries(toolSwitchNames.map((name) => [name, z.boolean()])) as Record<
    (typeof toolSwitchNames)[number],
    z.ZodBoolean
  >
);

export const settingsViewSchema = z.object({
  mailboxId: z.uuid(),
  mode: z.enum(mailboxModes),
  toolSwitches: toolSwitchesViewSchema,
  movesSupported: z.boolean(),
  categories: z.array(categorySettingSchema),
  syncFolders: z.array(syncFolderViewSchema),
  bar: z.number(),
  minKept: z.number().int(),
});
// "Web" in the name: the server's config module already exports a SettingsView.
export type SettingsWebView = z.infer<typeof settingsViewSchema>;

export const settingsChangeSchema = z.object({
  changed: z.boolean(),
  expired: z.number().int().min(0),
  settings: settingsViewSchema,
});
export type SettingsWebChange = z.infer<typeof settingsChangeSchema>;

export const modeBodySchema = z.object({ mode: z.enum(mailboxModes), keepSwitches: z.boolean() });
export const switchBodySchema = z.object({ value: z.boolean() });
export const autoBodySchema = z.object({ auto: z.boolean(), force: z.boolean().optional() });
export const syncFolderBodySchema = z.object({ enabled: z.boolean() });
export const noGoBodySchema = z.object({ error: z.literal("no_go"), gate: gateViewSchema });
