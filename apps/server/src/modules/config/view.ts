import { autoFor, barCategories, GATE_BAR, GATE_MIN_KEPT, thresholdFor } from "@ea/core";
import type { BarCategory, GateView, SettingsWebView } from "@ea/core";

import type { TenantContext } from "../../platform/db";

import { getSettingsView, type SettingsDeps } from "./service";

export interface SettingsViewDeps {
  settings: SettingsDeps;
  goNoGo(ctx: TenantContext, mailboxId: string, now: Date): Promise<Record<BarCategory, GateView>>;
  listSyncFolders(ctx: TenantContext, mailboxId: string): Promise<SettingsWebView["syncFolders"]>;
}

// Three reads, no write. Throws `SettingsNotFoundError` when the mailbox has no settings row.
export async function buildSettingsView(
  deps: SettingsViewDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<SettingsWebView> {
  const view = await getSettingsView(deps.settings, ctx, mailboxId);
  const gates = await deps.goNoGo(ctx, mailboxId, deps.settings.now());
  const syncFolders = await deps.listSyncFolders(ctx, mailboxId);
  return {
    mailboxId,
    mode: view.mode,
    toolSwitches: view.toolSwitches,
    movesSupported: view.movesSupported,
    categories: barCategories.map((category) => ({
      category,
      auto: autoFor(view.categoryPolicy, category),
      threshold: thresholdFor(view.categoryPolicy, category),
      gate: gates[category],
    })),
    syncFolders,
    bar: GATE_BAR,
    minKept: GATE_MIN_KEPT,
  };
}
