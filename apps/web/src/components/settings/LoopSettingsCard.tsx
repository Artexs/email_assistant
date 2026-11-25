import type { SettingsWebChange, SettingsWebView } from "@ea/core/web";
import { Info, Repeat } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t, tp, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { LOOP_WAIT_OPTIONS, loopControls } from "../../lib/loop-settings";
import { patchSettings } from "../../lib/settings-api";
import { FactBox } from "../patterns/FactBox";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Switch } from "../ui/switch";
import { selectClass } from "./NoticeRoutesCard";

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
    <SectionCard data-card="loops" icon={Repeat} title={t("lset_title")}>
      {controls.needsSentTracking && <FactBox icon={Info}>{t("lset_needs_sent")}</FactBox>}
      <RowList>
        <Row
          title={t("lset_wait_label")}
          htmlFor="loop-wait"
          hint={<span id="loop-wait-help">{t("lset_wait_help")}</span>}
        >
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
        </Row>
        <Row
          title={t("lset_auto_label")}
          htmlFor="loop-auto"
          hint={<span id="loop-auto-help">{t("lset_auto_help")}</span>}
        >
          <Switch
            id="loop-auto"
            aria-describedby="loop-auto-help"
            checked={settings.toolSwitches.auto_follow_up === true}
            disabled={off}
            onCheckedChange={(value) =>
              void write("/switches/auto_follow_up", { value }, value ? "lset_auto_on_toast" : "lset_auto_off_toast")
            }
          />
        </Row>
      </RowList>
    </SectionCard>
  );
}
