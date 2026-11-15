import { formatClock, type SettingsWebChange, type SettingsWebView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { getLocale, t, type TextKey } from "../../i18n";
import { changeSentSync } from "../../lib/sent-switch";
import { sentStatusLine } from "../../lib/sent-text";
import { patchSettings } from "../../lib/settings-api";
import { useNow } from "../../lib/use-now";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

export interface SentMailCardProps {
  settings: SettingsWebView;
  isOwner: boolean;
  timeZone: string;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

// "Track my sent mail". The page renders it only while `settings.sentSync` is not null.
export function SentMailCard({ settings, isOwner, timeZone, onChanged, onMissing }: SentMailCardProps) {
  const [pending, setPending] = useState(false);
  const now = useNow();
  const sent = settings.sentSync;
  if (sent === null) return null;

  const change = async (enabled: boolean) => {
    setPending(true);
    try {
      await changeSentSync(
        { patch: patchSettings, onChanged, toastError: (key) => toast.error(t(key)), onMissing },
        settings.mailboxId,
        enabled
      );
    } finally {
      setPending(false);
    }
  };

  const status = sentStatusLine(sent);

  return (
    <Card data-card="sent">
      <CardHeader>
        <CardTitle>{t("sent_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{t("sent_switch")}</span>
          <Switch
            aria-label={t("sent_switch")}
            checked={sent.enabled}
            disabled={!isOwner || pending || (!sent.flagOn && !sent.enabled)}
            onCheckedChange={(enabled) => void change(enabled)}
          />
        </div>
        <p className="text-sm">{t("sent_line")}</p>
        {sent.folder !== null && <p className="truncate text-sm text-muted-foreground">{sent.folder}</p>}
        {status !== null && (
          <p className="text-sm text-muted-foreground">
            {status.key === "sent_last" && status.vars !== undefined
              ? t("sent_last", { time: formatClock(new Date(status.vars.at ?? ""), timeZone, now, getLocale()) })
              : t(status.key)}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("sent_off_note")}</p>
      </CardContent>
    </Card>
  );
}
