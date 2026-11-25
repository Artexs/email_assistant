import { formatClock, type SettingsWebChange, type SettingsWebView } from "@ea/core/web";
import { PauseCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getLocale, t, type TextKey } from "../../i18n";
import { changeSentSync } from "../../lib/sent-switch";
import { sentStatusLine } from "../../lib/sent-text";
import { patchSettings } from "../../lib/settings-api";
import { useNow } from "../../lib/use-now";
import { FactBox } from "../patterns/FactBox";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
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

  const statusText =
    status === null
      ? null
      : status.key === "sent_last" && status.vars !== undefined
        ? t("sent_last", { time: formatClock(new Date(status.vars.at ?? ""), timeZone, now, getLocale()) })
        : t(status.key);

  return (
    <SectionCard data-card="sent" icon={Send} title={t("sent_title")}>
      <RowList>
        <Row
          title={t("sent_switch")}
          htmlFor="sent-switch"
          hint={
            <>
              <p>{t("sent_line")}</p>
              {sent.folder !== null && <p className="truncate">{sent.folder}</p>}
            </>
          }
        >
          <Switch
            id="sent-switch"
            checked={sent.enabled}
            disabled={!isOwner || pending || (!sent.flagOn && !sent.enabled)}
            onCheckedChange={(enabled) => void change(enabled)}
          />
        </Row>
      </RowList>
      {statusText === null ? null : status?.key === "sent_paused" ? (
        <FactBox icon={PauseCircle}>{statusText}</FactBox>
      ) : (
        <p className="text-sm text-muted-foreground">{statusText}</p>
      )}
      <p className="text-sm text-muted-foreground">{t("sent_off_note")}</p>
    </SectionCard>
  );
}
