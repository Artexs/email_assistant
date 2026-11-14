import { changePasswordFormSchema, fieldErrors as toFieldErrors, sessionsSchema } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { getLocale, setLocale, t, useLocale, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { errorText } from "../../lib/errors";
import { saveLocale } from "../../lib/locale-api";
import { changePasswordError, signOutAllResult } from "../../lib/password-errors";
import { useResource } from "../../lib/use-resource";
import { useMe } from "../shell/MeProvider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { SecurityLog } from "./SecurityLog";
import { TwoFactorSection } from "./TwoFactorSection";

type Field = "current" | "password" | "repeat";
type FieldErrors = Partial<Record<Field, TextKey>>;

// English keeps the browser default; Polish is fixed so the date matches the panel language.
function dateFormat(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLocale() === "pl" ? "pl-PL" : undefined, { dateStyle: "medium" });
}

// L21: the member's own live sessions, with a mark on this device. No button ends one session (B3).
function SessionsList() {
  const { data, error, loading, reload } = useResource(() => api("/api/me/sessions", sessionsSchema));
  return (
    <section data-section="sessions" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("acct_sessions_title")}</h3>
      {data === null && error !== null ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-destructive text-sm">
            {t("load_error_text")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t("retry")}
          </Button>
        </div>
      ) : data === null || loading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.sessions.map((session) => (
            <li
              key={session.id}
              data-session={session.id}
              className="flex flex-col gap-1 rounded-md border p-3 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                {t("device_on", {
                  browser: t(`browser_${session.device.browser}`),
                  os: t(`os_${session.device.os}`),
                })}
                {session.current ? <Badge data-badge="this-device">{t("acct_this_device")}</Badge> : null}
              </span>
              <span className="text-muted-foreground">{session.address ?? t("acct_unknown_address")}</span>
              <span className="text-muted-foreground">
                {t("acct_last_active", { date: dateFormat().format(new Date(session.lastUsedAt)) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The language is a display setting: a paused organization may change it, so the select ignores `canWrite`.
function LanguageSelect() {
  const locale = useLocale();
  const { reload } = useMe();
  const [saving, setSaving] = useState(false);

  async function onChange(value: string) {
    if (value !== "pl" && value !== "en") return;
    setSaving(true);
    try {
      await saveLocale(value);
      setLocale(value);
      reload();
      toast.success(t("acct_language_saved"));
    } catch (caught) {
      toast.error(t(errorText(caught)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="acct-language">{t("acct_language_label")}</Label>
      <Select value={locale} onValueChange={(value) => void onChange(value)} disabled={saving}>
        <SelectTrigger id="acct-language" className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pl">{t("acct_language_pl")}</SelectItem>
          <SelectItem value="en">{t("acct_language_en")}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-sm">{t("acct_language_help")}</p>
    </div>
  );
}

export function AccountCard() {
  const { me } = useMe();
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
        <LanguageSelect />
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
        <div className="border-t pt-4">
          <TwoFactorSection />
        </div>
        <div className="flex flex-col items-start gap-2 border-t pt-4">
          <div className="w-full">
            <SessionsList />
          </div>
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
        {me !== null && me.role === "owner" && me.features.includes("security_log") ? (
          <div className="border-t pt-4">
            <SecurityLog timeZone={me.organization.timezone} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
