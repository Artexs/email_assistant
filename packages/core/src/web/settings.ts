import { syncFolderKeys, syncFolderRoles } from "../mail/sync-folders";
import { mailboxModes } from "../triage/categories";
import { barCategories } from "../triage/metrics";
import { toolSwitchNames } from "../triage/settings";
import { urgencyProfileSchema } from "../triage/urgency-profile";
import { evidenceBlocks } from "../trust/evidence";

import { z } from "./zod";

export { barCategories, type BarCategory } from "../triage/metrics";
export { toolSwitchNames, loopSwitchNames, ASSIST_DEFAULT_SWITCHES } from "../triage/settings";

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

export const sentSyncErrorCodes = ["no_folder", "folder_missing", "failed"] as const;

// "Track my sent mail" of one mailbox. The whole field is null while the organization flag is off and the switch is off.
export const sentSyncViewSchema = z.object({
  // false: paused. The switch can only go off.
  flagOn: z.boolean(),
  enabled: z.boolean(),
  // folder_map.sent: null when no Sent folder is known.
  folder: z.string().nullable(),
  firstPassDone: z.boolean(),
  // The newest user mail in the current Sent folder.
  lastSentAt: z.iso.datetime().nullable(),
  // User mail of the last 30 days.
  storedCount: z.number().int().min(0),
  errorCode: z.enum(sentSyncErrorCodes).nullable(),
});
export type SentSyncView = z.infer<typeof sentSyncViewSchema>;

// The switches of the mailbox tools. `auto_follow_up` is in the list only while the flag `open_loops` is on.
const toolSwitchesViewSchema = z.strictObject({
  ...(Object.fromEntries(toolSwitchNames.map((name) => [name, z.boolean()])) as Record<
    (typeof toolSwitchNames)[number],
    z.ZodBoolean
  >),
  auto_follow_up: z.boolean().optional(),
});

// The state of "Track my sent mail" for the loop settings card: `flag_off` while the organization flag is off (also when
// the switch is still on: the sync is paused).
export const sentTrackingStates = ["on", "off", "flag_off"] as const;
export type SentTracking = (typeof sentTrackingStates)[number];

export function sentTrackingOf(sentSync: SentSyncView | null): SentTracking {
  if (sentSync === null || !sentSync.flagOn) return "flag_off";
  return sentSync.enabled ? "on" : "off";
}

export const settingsViewSchema = z.object({
  mailboxId: z.uuid(),
  mode: z.enum(mailboxModes),
  toolSwitches: toolSwitchesViewSchema,
  movesSupported: z.boolean(),
  categories: z.array(categorySettingSchema),
  syncFolders: z.array(syncFolderViewSchema),
  // null: no profile set. An empty profile is stored as null.
  urgencyProfile: urgencyProfileSchema.nullable(),
  sentSync: sentSyncViewSchema.nullable(),
  sentTracking: z.enum(sentTrackingStates),
  // Working days before a waiting loop is due (1–10, default 3).
  loopWaitDays: z.number().int().min(1).max(10),
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
// `null` clears the profile. An empty profile clears it too.
export const urgencyBodySchema = z.object({ profile: urgencyProfileSchema.nullable() });
export const syncFolderBodySchema = z.object({ enabled: z.boolean() });
export const sentSyncBodySchema = z.object({ enabled: z.boolean() });
// `blocks`: only with the flag `trust_ladder` on. Each code says one reason the evidence gate refused
export const noGoBodySchema = z.object({
  error: z.literal("no_go"),
  gate: gateViewSchema,
  blocks: z.array(z.enum(evidenceBlocks)).optional(),
});
