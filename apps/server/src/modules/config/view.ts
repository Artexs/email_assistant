import { autoFor, barCategories, GATE_BAR, GATE_MIN_KEPT, sentTrackingOf, thresholdFor } from "@ea/core";
import type { BarCategory, GateView, SettingsWebView } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { isFeatureOn } from "../tenancy";

import { getSettingsView, type SettingsDeps } from "./service";

export interface SettingsViewDeps {
  settings: SettingsDeps;
  goNoGo(ctx: TenantContext, mailboxId: string, now: Date): Promise<Record<BarCategory, GateView>>;
  listSyncFolders(ctx: TenantContext, mailboxId: string): Promise<SettingsWebView["syncFolders"]>;
  getSentSync(ctx: TenantContext, mailboxId: string): Promise<SettingsWebView["sentSync"]>;
}

// Five reads, no write. The switch `auto_follow_up` is in the list only while the flag `open_loops` is on. Throws `SettingsNotFoundError` when the mailbox has no settings row.
export async function buildSettingsView(
  deps: SettingsViewDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<SettingsWebView> {
  const view = await getSettingsView(deps.settings, ctx, mailboxId);
  const gates = await deps.goNoGo(ctx, mailboxId, deps.settings.now());
  const syncFolders = await deps.listSyncFolders(ctx, mailboxId);
  const sentSync = await deps.getSentSync(ctx, mailboxId);
  const { auto_follow_up: autoFollowUp, ...toolSwitches } = view.toolSwitches;
  const loopsOn = await isFeatureOn(deps.settings.db, ctx, "open_loops");
  return {
    mailboxId,
    mode: view.mode,
    toolSwitches: loopsOn ? { ...toolSwitches, auto_follow_up: autoFollowUp } : toolSwitches,
    movesSupported: view.movesSupported,
    categories: barCategories.map((category) => ({
      category,
      auto: autoFor(view.categoryPolicy, category),
      threshold: thresholdFor(view.categoryPolicy, category),
      gate: gates[category],
    })),
    syncFolders,
    urgencyProfile: view.urgencyProfile,
    sentSync,
    sentTracking: sentTrackingOf(sentSync),
    loopWaitDays: view.loopWaitDays,
    bar: GATE_BAR,
    minKept: GATE_MIN_KEPT,
  };
}
