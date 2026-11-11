import { changePasswordFormSchema, fieldErrors as toFieldErrors } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n/en";
import { authClient } from "../../lib/auth-client";
import { changePasswordError, signOutAllResult } from "../../lib/password-errors";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

type Field = "current" | "password" | "repeat";
type FieldErrors = Partial<Record<Field, TextKey>>;

export function AccountCard() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<TextKey | null>(null);
  const [signOutError, setSignOutError] = useState<TextKey | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = changePasswordFormSchema.safeParse({ current, password, repeat });
    if (!parsed.success) {
      const errors = toFieldErrors(parsed);
      setFieldErrors({
        ...(errors.current === undefined ? {} : { current: errors.current as TextKey }),
        ...(errors.password === undefined ? {} : { password: errors.password as TextKey }),
        ...(errors.repeat === undefined ? {} : { repeat: errors.repeat as TextKey }),
      });
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.changePassword({
        currentPassword: current,
        newPassword: password,
        revokeOtherSessions: revokeOthers,
      });
      const failure = changePasswordError(authError);
      if (failure === null) {
        setCurrent("");
        setPassword("");
        setRepeat("");
        toast.success(t(revokeOthers ? "acct_changed_others_toast" : "acct_changed_toast"));
      } else if (failure.field === null) {
        setError(failure.key);
      } else {
        setFieldErrors({ [failure.field]: failure.key });
      }
    } catch {
      setError("error_generic");
    } finally {
      setPending(false);
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error: authError } = await authClient.revokeSessions();
      const result = signOutAllResult(authError);
      if (result.done) {
        location.assign("/login");
        return;
      }
      setSignOutError(result.key);
    } catch {
      setSignOutError("error_generic");
    }
    setSigningOut(false);
  }

  return (
    <Card data-card="account">
      <CardHeader>
        <CardTitle>{t("acct_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form method="post" onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="acct-current">{t("acct_current_label")}</Label>
            <Input
              id="acct-current"
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              aria-invalid={fieldErrors.current !== undefined}
              aria-describedby={fieldErrors.current === undefined ? undefined : "acct-current-error"}
            />
            {fieldErrors.current === undefined ? null : (
              <p id="acct-current-error" role="alert" className="text-destructive text-sm">
                {t(fieldErrors.current)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acct-new">{t("new_password_label")}</Label>
            <Input
              id="acct-new"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={fieldErrors.password === undefined ? "acct-new-help" : "acct-new-help acct-new-error"}
            />
            <p id="acct-new-help" className="text-muted-foreground text-sm">
              {t("password_help")}
            </p>
            {fieldErrors.password === undefined ? null : (
              <p id="acct-new-error" role="alert" className="text-destructive text-sm">
                {t(fieldErrors.password)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acct-repeat">{t("repeat_password_label")}</Label>
            <Input
              id="acct-repeat"
              name="repeat-password"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              aria-invalid={fieldErrors.repeat !== undefined}
              aria-describedby={fieldErrors.repeat === undefined ? undefined : "acct-repeat-error"}
            />
            {fieldErrors.repeat === undefined ? null : (
              <p id="acct-repeat-error" role="alert" className="text-destructive text-sm">
                {t(fieldErrors.repeat)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="acct-revoke" checked={revokeOthers} onCheckedChange={setRevokeOthers} disabled={pending} />
            <Label htmlFor="acct-revoke">{t("acct_revoke_others")}</Label>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? t("acct_changing") : t("acct_change")}
            </Button>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {t(error)}
            </p>
          )}
        </form>
        <div className="flex flex-col items-start gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={signingOut}
            onClick={() => void signOutEverywhere()}
          >
            {t("acct_sign_out_all")}
          </Button>
          <p className="text-muted-foreground text-sm">{t("acct_sign_out_all_help")}</p>
          {signOutError === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {t(signOutError)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
