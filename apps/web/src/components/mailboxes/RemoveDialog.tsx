import { sameAddress, type MailboxView } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { t } from "../../i18n/en";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface RemoveDialogProps {
  mailbox: MailboxView;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemoved(): void;
}

export function RemoveDialog({ mailbox, open, onOpenChange, onRemoved }: RemoveDialogProps) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const changeOpen = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setTyped("");
      setFailed(false);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sameAddress(typed, mailbox.address)) return;
    setFailed(false);
    setPending(true);
    try {
      await api(`/api/mailboxes/${mailbox.id}`, z.undefined(), { method: "DELETE", body: { confirmAddress: typed } });
      toast.success(t("removed_toast"));
      setTyped("");
      onOpenChange(false);
      onRemoved();
    } catch (caught) {
      // A 400 `confirm_mismatch` cannot happen while the button rule holds: it gets the generic text too.
      setFailed(true);
      toast.error(t(caught instanceof ApiError ? errorText(caught) : "error_generic"));
    } finally {
      setPending(false);
    }
  };

  const inputId = `remove-confirm-${mailbox.id}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("remove_title")}</DialogTitle>
            <DialogDescription>{t("remove_text", { address: mailbox.address })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>{t("remove_confirm_label")}</Label>
            <Input
              id={inputId}
              autoComplete="off"
              value={typed}
              disabled={pending}
              aria-invalid={failed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !sameAddress(typed, mailbox.address)}>
              {t("remove_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
