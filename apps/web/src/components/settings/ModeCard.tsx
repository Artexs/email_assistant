import { toolSwitchNames, type MailboxView, type SettingsWebChange, type SettingsWebView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { replySwitchBlocked } from "../../lib/reply-style";
import { patchSettings } from "../../lib/settings-api";
import { useModeChange } from "../../lib/use-mode-change";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { AssistDialog } from "./AssistDialog";

export interface ModeCardProps {
  mailbox: MailboxView;
  settings: SettingsWebView;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

const modeTexts = {
  shadow: { name: "mode_shadow", text: "mode_shadow_text" },
  assist: { name: "mode_assist", text: "mode_assist_text" },
} as const;

export function ModeCard({ mailbox, settings, isOwner, onChanged, onMissing }: ModeCardProps) {
  const [assistOpen, setAssistOpen] = useState(false);
  const [pendingSwitches, setPendingSwitches] = useState<ReadonlySet<string>>(new Set());

  const fail = (error: unknown) => {
    toast.error(t(errorText(error)));
    if (error instanceof ApiError && error.status === 404) onMissing?.();
  };

  const { pending: modePending, change: changeMode } = useModeChange(mailbox.id, {
    onChanged: (change, mode) => {
      setAssistOpen(false);
      onChanged(change, mode === "assist" ? "mode_assist_toast" : "mode_shadow_toast");
    },
    onFail: fail,
  });

  const changeSwitch = async (name: (typeof toolSwitchNames)[number] | "reply_drafts", value: boolean) => {
    setPendingSwitches((prev) => new Set(prev).add(name));
    try {
      const change = await patchSettings(mailbox.id, `/switches/${name}`, { value });
      onChanged(change, value ? "switch_on_toast" : "switch_off_toast", { name: t(`switch_${name}`) });
    } catch (error) {
      fail(error);
    } finally {
      setPendingSwitches((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const texts = modeTexts[settings.mode];
  // The settings view holds `reply_drafts` only while the flag of the organization is on, so its absence hides the row.
  const replySwitch = settings.toolSwitches.reply_drafts;
  const replyBlocked = replySwitchBlocked(mailbox);

  return (
    <Card data-card="mode">
      <CardHeader>
        <CardTitle>{t("mode_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t(texts.name)}</p>
          <p className="text-sm text-muted-foreground">{t(texts.text)}</p>
          {!settings.movesSupported && <p className="text-sm text-muted-foreground">{t("moves_unsupported")}</p>}
        </div>
        {isOwner && (
          <div>
            {settings.mode === "shadow" ? (
              <Button onClick={() => setAssistOpen(true)}>{t("mode_to_assist")}</Button>
            ) : (
              <Button variant="outline" disabled={modePending} onClick={() => void changeMode("shadow", false)}>
                {t("mode_to_shadow")}
              </Button>
            )}
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {toolSwitchNames.map((name) => (
            <li key={name} className="flex items-center gap-2">
              <Switch
                id={`switch_${name}`}
                checked={settings.toolSwitches[name]}
                disabled={!isOwner || pendingSwitches.has(name)}
                onCheckedChange={(value) => void changeSwitch(name, value)}
              />
              <Label htmlFor={`switch_${name}`}>{t(`switch_${name}`)}</Label>
            </li>
          ))}
        </ul>
        {replySwitch !== undefined && (
          <div data-switch="reply_drafts" className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Switch
                id="switch_reply_drafts"
                aria-describedby={
                  replyBlocked ? "switch_reply_drafts_help switch_reply_drafts_oauth" : "switch_reply_drafts_help"
                }
                checked={replySwitch}
                disabled={!isOwner || replyBlocked || pendingSwitches.has("reply_drafts")}
                onCheckedChange={(value) => void changeSwitch("reply_drafts", value)}
              />
              <Label htmlFor="switch_reply_drafts">{t("switch_reply_drafts")}</Label>
            </div>
            <p id="switch_reply_drafts_help" className="text-sm text-muted-foreground">
              {t("rs_switch_help")}
            </p>
            {replyBlocked && (
              <p id="switch_reply_drafts_oauth" className="text-sm text-muted-foreground">
                {t("rs_switch_oauth")}
              </p>
            )}
          </div>
        )}
        {isOwner && (
          <AssistDialog
            mailbox={mailbox}
            switches={settings.toolSwitches}
            open={assistOpen}
            onOpenChange={setAssistOpen}
            onChoose={(keepSwitches) => void changeMode("assist", keepSwitches)}
            pending={modePending}
          />
        )}
      </CardContent>
    </Card>
  );
}
