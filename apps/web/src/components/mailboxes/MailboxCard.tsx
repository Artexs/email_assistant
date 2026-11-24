import { formatClock, mailboxViewSchema, type MailboxView } from "@ea/core/web";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { getLocale, t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { startOAuth, watchPageRestore } from "../../lib/mail-oauth";
import { mailboxCardHint, mailboxCardState, mailboxCardUi } from "../../lib/mailbox-status";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { PasswordDialog } from "./PasswordDialog";
import { RemoveDialog } from "./RemoveDialog";
import { ScopeBadges } from "./ScopeBadges";

export interface MailboxCardProps {
  mailbox: MailboxView;
  isOwner: boolean;
  timeZone: string;
  now: Date;
  onChanged: () => void;
}

const modeTexts = { shadow: "mb_mode_shadow", assist: "mb_mode_assist" } as const;
const providerTexts = { microsoft: "mb_provider_microsoft", google: "mb_provider_google" } as const;

// The address breaks before the `@` on a narrow card; the full address stays in `title`.
function Address({ address }: { address: string }) {
  const at = address.indexOf("@");
  return (
    <p className="min-w-0 font-bold" title={address}>
      {at < 0 ? address : address.slice(0, at)}
      {at < 0 ? null : (
        <>
          <wbr />
          {address.slice(at)}
        </>
      )}
    </p>
  );
}

export function MailboxCard({ mailbox, isOwner, timeZone, now, onChanged }: MailboxCardProps) {
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const state = mailboxCardState(mailbox);
  const ui = mailboxCardUi[state];
  const hint = mailboxCardHint(state, mailbox.authReason);
  const StatusIcon = ui.icon;
  const isPassword = mailbox.authMethod === "password";

  // Back from the provider, the browser may restore this page with the Reconnect still pending.
  useEffect(() => watchPageRestore(window, () => setReconnecting(false)), []);

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

  const reconnect = async () => {
    if (mailbox.oauthProvider === null) return;
    setReconnecting(true);
    const result = await startOAuth(mailbox.oauthProvider, undefined, mailbox.id);
    // On success the page is leaving for the provider: the button stays off until it does.
    if (!result.ok) {
      toast.error(t(result.key));
      setReconnecting(false);
    }
  };

  const statusLabel: TextKey | null = ui.label;
  const canReconnect = state === "access_revoked" && mailbox.oauthProvider !== null;

  return (
    <Card data-state={state} className={cn("gap-4 p-5", ui.error && "border border-destructive shadow-none")}>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex items-start gap-3">
          <InitialsAvatar name={mailbox.address} />
          <div className="flex min-w-0 flex-col">
            <Address address={mailbox.address} />
            {mailbox.oauthProvider !== null && (
              <p className="text-sm text-muted-foreground">{t(providerTexts[mailbox.oauthProvider])}</p>
            )}
          </div>
        </div>
        <p
          className={cn(
            "flex items-start gap-2 text-sm font-bold",
            ui.error ? "text-destructive" : state === "connected" ? "text-primary" : "text-muted-foreground"
          )}
        >
          <StatusIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {statusLabel === null
              ? t("mb_last_sync", {
                  time: formatClock(new Date(mailbox.lastSyncedAt ?? now), timeZone, now, getLocale()),
                })
              : t(statusLabel)}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{t(mailbox.mode === null ? "mb_mode_none" : modeTexts[mailbox.mode])}</Badge>
        </div>
        <ScopeBadges scopes={mailbox.scopes} />
        {isOwner && hint !== null && <p className="text-sm text-destructive">{t(hint)}</p>}
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            {(state === "connected" || state === "never_synced") && (
              <Button variant="soft" disabled={busy} onClick={() => void switchStatus("pause")}>
                {t("mb_pause")}
              </Button>
            )}
            {state === "paused" && (
              <Button variant="soft" disabled={busy} onClick={() => void switchStatus("resume")}>
                {t("mb_resume")}
              </Button>
            )}
            {state === "login_error" && (
              <Button onClick={() => setPasswordOpen(true)}>{t("mb_change_password")}</Button>
            )}
            {canReconnect && (
              <Button disabled={reconnecting} onClick={() => void reconnect()}>
                {t("mb_reconnect")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">{t("mb_more")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isPassword && (
                  <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>{t("mb_change_password")}</DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
                  {t("mb_remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isPassword && (
              <PasswordDialog
                mailbox={mailbox}
                open={passwordOpen}
                onOpenChange={setPasswordOpen}
                onSaved={onChanged}
              />
            )}
            <RemoveDialog mailbox={mailbox} open={removeOpen} onOpenChange={setRemoveOpen} onRemoved={onChanged} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
