import { orgDeleteResponseSchema } from "@ea/core/web";
import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import {
  canDeleteOrganization,
  createDeleteRunner,
  deleteFormReducer,
  deleteSubmitEnabled,
  emptyDeleteForm,
} from "../../lib/delete-organization";
import type { DeleteError } from "../../lib/errors";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// Id of the paragraph that shows the error of a field; a form-wide error (null) describes both fields.
function errorId(error: DeleteError | null, field: "password" | "name"): string | undefined {
  if (error === null) return undefined;
  if (error.field === field) return `del-${field}-error`;
  return error.field === null ? "del-error" : undefined;
}

// F106 D5: the owner deletes the organization from the end of the Account card (flag `org_delete`). The password
// and the typed name live only in this component's state: they are cleared when the dialog closes and after every
// outcome, and they are never stored, logged or put in a URL.
export function DeleteOrganization() {
  const { me } = useMe();
  const [runner] = useState(() =>
    createDeleteRunner({
      request: (body) => api("/api/organization", orgDeleteResponseSchema, { method: "DELETE", body }),
      storage: () => {
        try {
          return sessionStorage;
        } catch {
          return undefined;
        }
      },
      goTo: (url) => location.assign(url),
      now: () => Date.now(),
    })
  );
  const [open, setOpen] = useState(false);
  const [form, dispatch] = useReducer(deleteFormReducer, emptyDeleteForm);
  const { password, name, pending, error } = form;
  const trigger = useRef<HTMLButtonElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  // A failure empties the password field: focus goes back to it for the next try (the field is enabled again).
  useEffect(() => {
    if (error !== null) passwordInput.current?.focus();
  }, [error]);

  if (me === null || !canDeleteOrganization(me)) return null;
  const organizationName = me.organization.name;
  const enabled = deleteSubmitEnabled(organizationName, name, password, pending);

  function changeOpen(next: boolean) {
    // The dialog stays open while the request runs.
    if (pending) return;
    if (!next) dispatch({ type: "close" });
    setOpen(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled) return;
    dispatch({ type: "submit" });
    const outcome = await runner({ password, confirmName: name });
    // `undefined`: a second submit while the first one runs. The first one ends the form state.
    if (outcome === undefined) return;
    dispatch({ type: "outcome", outcome });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="text-destructive"
        data-action="delete-organization"
        onClick={() => changeOpen(true)}
      >
        {t("del_title")}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            passwordInput.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("del_title")}</DialogTitle>
              <DialogDescription>{t("del_text", { name: organizationName })}</DialogDescription>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">{t("del_imap_note")}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="del-password">{t("del_password_label")}</Label>
              <Input
                id="del-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                ref={passwordInput}
                value={password}
                disabled={pending}
                onChange={(event) => dispatch({ type: "password", value: event.target.value })}
                aria-invalid={error !== null && error.field !== "name"}
                aria-describedby={errorId(error, "password")}
              />
              {error !== null && error.field === "password" ? (
                <p id="del-password-error" role="alert" className="text-destructive text-sm">
                  {t(error.key)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="del-name">{t("del_confirm_label")}</Label>
              <Input
                id="del-name"
                name="confirm-name"
                autoComplete="off"
                value={name}
                disabled={pending}
                onChange={(event) => dispatch({ type: "name", value: event.target.value })}
                aria-invalid={error !== null && error.field !== "password"}
                aria-describedby={errorId(error, "name")}
              />
              {error !== null && error.field === "name" ? (
                <p id="del-name-error" role="alert" className="text-destructive text-sm">
                  {t(error.key)}
                </p>
              ) : null}
            </div>
            {error !== null && error.field === null ? (
              <p id="del-error" role="alert" className="text-destructive text-sm">
                {t(error.key)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!enabled}>
                {pending ? t("del_deleting") : t("del_submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
