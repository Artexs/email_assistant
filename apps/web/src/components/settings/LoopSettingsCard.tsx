import type { SettingsWebChange, SettingsWebView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, tp, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { LOOP_WAIT_OPTIONS, loopControls } from "../../lib/loop-settings";
import { patchSettings } from "../../lib/settings-api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export interface LoopSettingsCardProps {
  settings: SettingsWebView;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone, or the flag went off: the page reloads its mailbox list.
  onMissing?(): void;
}

// "Open loops" under the "Track my sent mail" card: the wait before a follow-up and the automatic drafts. The card is absent
// while the flag `open_loops` is off; both controls are disabled while Sent tracking is not on.
export function LoopSettingsCard({ settings, isOwner, onChanged, onMissing }: LoopSettingsCardProps) {
  const [pending, setPending] = useState(false);
  const controls = loopControls(settings, isOwner);
  if (!controls.visible) return null;

  const write = async (tail: string, body: unknown, toastKey: TextKey) => {
    setPending(true);
    try {
      onChanged(await patchSettings(settings.mailboxId, tail, body), toastKey);
    } catch (error) {
      toast.error(t(errorText(error)));
      if (error instanceof ApiError && error.status === 404) onMissing?.();
    } finally {
      setPending(false);
    }
  };

  const off = controls.disabled || pending;

  return (
    <Card data-card="loops">
      <CardHeader>
        <CardTitle>{t("lset_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {controls.needsSentTracking && <p className="text-sm text-muted-foreground">{t("lset_needs_sent")}</p>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loop-wait">{t("lset_wait_label")}</Label>
          <select
            id="loop-wait"
            aria-describedby="loop-wait-help"
            value={settings.loopWaitDays}
            disabled={off}
            className={selectClass}
            onChange={(event) => void write("/loop-wait", { days: Number(event.target.value) }, "lset_wait_toast")}
          >
            {LOOP_WAIT_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {tp("lset_wait_days", days)}
              </option>
            ))}
          </select>
          <p id="loop-wait-help" className="text-sm text-muted-foreground">
            {t("lset_wait_help")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id="loop-auto"
              aria-describedby="loop-auto-help"
              checked={settings.toolSwitches.auto_follow_up === true}
              disabled={off}
              onCheckedChange={(value) =>
                void write("/switches/auto_follow_up", { value }, value ? "lset_auto_on_toast" : "lset_auto_off_toast")
              }
            />
            <Label htmlFor="loop-auto">{t("lset_auto_label")}</Label>
          </div>
          <p id="loop-auto-help" className="text-sm text-muted-foreground">
            {t("lset_auto_help")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
