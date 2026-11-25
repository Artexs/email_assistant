import { changePasswordFormSchema, fieldErrors as toFieldErrors, sessionsSchema } from "@ea/core/web";
import { ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { getLocale, setLocale, t, useLocale, type TextKey } from "../../i18n";
import { accountSections } from "../../lib/account-sections";
import { api } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { errorText } from "../../lib/errors";
import { saveLocale } from "../../lib/locale-api";
import { changePasswordError, signOutAllResult } from "../../lib/password-errors";
import { useResource } from "../../lib/use-resource";
import { LegalLinks } from "../legal/LegalLinks";
import { useMe } from "../shell/MeProvider";
import { Badge } from "../ui/badge";
import { FactBox } from "../patterns/FactBox";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { DeleteOrganization } from "./DeleteOrganization";
import { SecurityLog } from "./SecurityLog";
import { TwoFactorSection } from "./TwoFactorSection";

type Field = "current" | "password" | "repeat";
type FieldErrors = Partial<Record<Field, TextKey>>;

// English keeps the browser default; Polish is fixed so the date matches the panel language.
function dateFormat(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLocale() === "pl" ? "pl-PL" : undefined, { dateStyle: "medium" });
}

// The member's own live sessions, with a mark on this device. No button ends one session.
function SessionsList({ ssoSession }: { ssoSession: boolean }) {
  const { data, error, loading, reload } = useResource(() => api("/api/me/sessions", sessionsSchema));
  return (
    <section data-section="sessions" className="flex flex-col gap-2">
      <h3 className="text-base font-bold">{t("acct_sessions_title")}</h3>
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
        <RowList>
          {data.sessions.map((session) => (
            <div key={session.id} data-session={session.id}>
              <Row
                title={t("device_on", {
                  browser: t(`browser_${session.device.browser}`),
                  os: t(`os_${session.device.os}`),
                })}
                hint={
                  <>
                    <span className="block">{session.address ?? t("acct_unknown_address")}</span>
                    <span className="block">
                      {t("acct_last_active", { date: dateFormat().format(new Date(session.lastUsedAt)) })}
                    </span>
                  </>
                }
              >
                {session.current ? <Badge data-badge="this-device">{t("acct_this_device")}</Badge> : null}
              </Row>
            </div>
          ))}
        </RowList>
      )}
      {ssoSession ? <p className="text-muted-foreground text-sm">{t("acct_sso_session")}</p> : null}
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
    <RowList>
      <Row title={t("acct_language_label")} hint={t("acct_language_help")} htmlFor="acct-language">
        <Select value={locale} onValueChange={(value) => void onChange(value)} disabled={saving}>
          <SelectTrigger id="acct-language" className="w-36 sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pl">{t("acct_language_pl")}</SelectItem>
            <SelectItem value="en">{t("acct_language_en")}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </RowList>
  );
}

// One labelled password field with its help and error lines. `help` and the error get their own ids, in the
// `aria-describedby` of the field.
function PasswordField({
  id,
  name,
  autoComplete,
  label,
  value,
  onChange,
  error,
  help,
}: {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  label: TextKey;
  value: string;
  onChange(next: string): void;
  error: TextKey | undefined;
  help?: TextKey;
}) {
  const described = [help === undefined ? null : `${id}-help`, error === undefined ? null : `${id}-error`].filter(
    (part) => part !== null
  );
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input
        id={id}
        name={name}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={described.length === 0 ? undefined : described.join(" ")}
      />
      {help === undefined ? null : (
        <p id={`${id}-help`} className="text-muted-foreground text-sm">
          {t(help)}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function AccountCard() {
  const { me } = useMe();
  const sections = accountSections(me);
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
    <>
      <SectionCard data-card="account" icon={UserRound} title={t("acct_title")}>
        <LanguageSelect />
        {sections.ssoOnlyHint ? (
          <FactBox>
            <p data-hint="sso-only">{t("acct_sso_only")}</p>
          </FactBox>
        ) : null}
        {sections.passwordControls ? (
          <form
            method="post"
            onSubmit={(event) => void onSubmit(event)}
            noValidate
            className="flex flex-col gap-4 border-t pt-4"
          >
            <h3 className="text-base font-bold">{t("acct_change")}</h3>
            <PasswordField
              id="acct-current"
              name="current-password"
              autoComplete="current-password"
              label="acct_current_label"
              value={current}
              onChange={setCurrent}
              error={fieldErrors.current}
            />
            <PasswordField
              id="acct-new"
              name="new-password"
              autoComplete="new-password"
              label="new_password_label"
              value={password}
              onChange={setPassword}
              error={fieldErrors.password}
              help="password_help"
            />
            <PasswordField
              id="acct-repeat"
              name="repeat-password"
              autoComplete="new-password"
              label="repeat_password_label"
              value={repeat}
              onChange={setRepeat}
              error={fieldErrors.repeat}
            />
            <RowList>
              <Row title={t("acct_revoke_others")} htmlFor="acct-revoke">
                <Switch id="acct-revoke" checked={revokeOthers} onCheckedChange={setRevokeOthers} disabled={pending} />
              </Row>
            </RowList>
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
        ) : null}
        <div className="flex flex-col items-start gap-2 border-t pt-4">
          <div className="w-full">
            <SessionsList ssoSession={sections.ssoSession} />
          </div>
          <Button
            type="button"
            variant="destructive-soft"
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
        <div data-section="legal" className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-base font-bold">{t("docs_links_label")}</h3>
          <LegalLinks newTab />
        </div>
      </SectionCard>
      {sections.securityCard ? (
        <SectionCard data-card="security" icon={ShieldCheck} title={t("acct_security_title")}>
          {sections.passwordControls ? <TwoFactorSection /> : null}
          {sections.securityLog && me !== null ? (
            <div className={sections.passwordControls ? "border-t pt-4" : undefined}>
              <SecurityLog timeZone={me.organization.timezone} />
            </div>
          ) : null}
        </SectionCard>
      ) : null}
      {sections.deleteBlock ? (
        <SectionCard
          data-card="delete-organization"
          icon={TriangleAlert}
          title={t("del_title")}
          lead={t("del_card_lead")}
          tone="danger"
        >
          <DeleteOrganization />
        </SectionCard>
      ) : null}
    </>
  );
}
