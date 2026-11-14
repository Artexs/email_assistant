import type { MailboxView, SettingsWebView } from "@ea/core/web";

import { t } from "../../i18n";
import { switchesAfterAssist } from "../../lib/settings-api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { ScopeBadges } from "../mailboxes/ScopeBadges";

export interface AssistDialogProps {
  mailbox: MailboxView;
  switches: SettingsWebView["toolSwitches"];
  open: boolean;
  onOpenChange(open: boolean): void;
  onChoose(keepSwitches: boolean): void;
  pending: boolean;
}

export function AssistDialog({ mailbox, switches, open, onOpenChange, onChoose, pending }: AssistDialogProps) {
  const kept = switchesAfterAssist(switches, true).map((name) => t(`switch_${name}`));
  const list = kept.length === 0 ? t("assist_none_on") : kept.join(", ");

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assist_title")}</DialogTitle>
          <DialogDescription>{t("assist_text", { address: mailbox.address })}</DialogDescription>
        </DialogHeader>
        <ScopeBadges scopes={mailbox.scopes} />
        <div className="flex flex-col gap-1.5">
          <Button disabled={pending} onClick={() => onChoose(false)}>
            {t("assist_usual")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("assist_usual_hint")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button variant="outline" disabled={pending} onClick={() => onChoose(true)}>
            {t("assist_keep")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("assist_keep_hint", { list })}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
