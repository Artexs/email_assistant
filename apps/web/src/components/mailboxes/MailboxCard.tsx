import { formatClock, mailboxViewSchema, type MailboxView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { getLocale, t } from "../../i18n";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { mailboxStatusUi } from "../../lib/mailbox-status";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { PasswordDialog } from "./PasswordDialog";
import { RemoveDialog } from "./RemoveDialog";
import { ScopeBadges } from "./ScopeBadges";
import { StatusBadge } from "./StatusBadge";

export interface MailboxCardProps {
  mailbox: MailboxView;
  isOwner: boolean;
  timeZone: string;
  now: Date;
  onChanged: () => void;
}

const modeTexts = { shadow: "mb_mode_shadow", assist: "mb_mode_assist" } as const;

export function MailboxCard({ mailbox, isOwner, timeZone, now, onChanged }: MailboxCardProps) {
  const [busy, setBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { hint } = mailboxStatusUi[mailbox.status];

  const switchStatus = async (action: "pause" | "resume") => {
    setBusy(true);
    try {
      await api(`/api/mailboxes/${mailbox.id}/${action}`, mailboxViewSchema, { method: "POST" });
      toast.success(t(action === "pause" ? "mb_paused_toast" : "mb_resumed_toast"));
      onChanged();
    } catch (error) {
      toast.error(t(errorText(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-medium" title={mailbox.address}>
            {mailbox.address}
          </p>
          <StatusBadge status={mailbox.status} />
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>
            {mailbox.lastSyncedAt === null
              ? t("mb_never_synced")
              : t("mb_last_sync", { time: formatClock(new Date(mailbox.lastSyncedAt), timeZone, now, getLocale()) })}
          </p>
          <p>{t(mailbox.mode === null ? "mb_mode_none" : modeTexts[mailbox.mode])}</p>
        </div>
        <ScopeBadges scopes={mailbox.scopes} />
        {isOwner && hint !== null && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{t(hint)}</p>
            </AlertDescription>
          </Alert>
        )}
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            {mailbox.status === "active" && (
              <Button variant="outline" disabled={busy} onClick={() => void switchStatus("pause")}>
                {t("mb_pause")}
              </Button>
            )}
            {mailbox.status === "paused" && (
              <Button variant="outline" disabled={busy} onClick={() => void switchStatus("resume")}>
                {t("mb_resume")}
              </Button>
            )}
            {mailbox.status === "auth_error" && (
              <Button onClick={() => setPasswordOpen(true)}>{t("mb_change_password")}</Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">{t("mb_more")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>{t("mb_change_password")}</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
                  {t("mb_remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PasswordDialog mailbox={mailbox} open={passwordOpen} onOpenChange={setPasswordOpen} onSaved={onChanged} />
            <RemoveDialog mailbox={mailbox} open={removeOpen} onOpenChange={setRemoveOpen} onRemoved={onChanged} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
