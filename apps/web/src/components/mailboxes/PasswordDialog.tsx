import { mailboxPasswordBodySchema, mailboxViewSchema, type MailboxView } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export interface PasswordDialogProps {
  mailbox: MailboxView;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(view: MailboxView): void;
}

export function PasswordDialog({ mailbox, open, onOpenChange, onSaved }: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [appPassword, setAppPassword] = useState(mailbox.secretKind === "app_password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);

  const changeOpen = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setPassword("");
      setError(null);
      setAppPassword(mailbox.secretKind === "app_password");
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { password, secretKind: appPassword ? ("app_password" as const) : ("password" as const) };
    if (!mailboxPasswordBodySchema.safeParse(body).success) {
      setError("err_required");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const view = await api(`/api/mailboxes/${mailbox.id}/password`, mailboxViewSchema, { method: "POST", body });
      const wasStopped = mailbox.status === "auth_error" || mailbox.status === "host_blocked";
      toast.success(t(wasStopped && view.status === "active" ? "password_saved_active" : "password_saved"));
      setPassword("");
      onSaved(view);
      onOpenChange(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };

  const inputId = `password-${mailbox.id}`;
  const switchId = `password-kind-${mailbox.id}`;
  const errorId = `password-error-${mailbox.id}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("password_title")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Switch id={switchId} checked={appPassword} onCheckedChange={setAppPassword} disabled={pending} />
            <Label htmlFor={switchId}>{t("app_password_switch")}</Label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>{t(appPassword ? "mb_new_app_password_label" : "mb_new_password_label")}</Label>
            <Input
              id={inputId}
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={pending}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error !== null && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t(pending ? "checking_login" : "save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
