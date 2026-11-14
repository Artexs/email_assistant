import { fieldErrors as toFieldErrors, loginFormSchema, safeNextPath } from "@ea/core/web";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AuthCard } from "../components/auth/AuthCard";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { t, type TextKey, useLocale } from "../i18n";
import { authClient } from "../lib/auth-client";
import { cleanBackupCode, cleanTotpCode, codeStepError } from "../lib/two-factor-errors";

type FieldErrors = Partial<Record<"email" | "password", TextKey>>;

function nextTarget(): string {
  return safeNextPath(new URLSearchParams(location.search).get("next"));
}

export default function LoginPage() {
  useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [setupDone, setSetupDone] = useState(false);
  const [step, setStep] = useState<"password" | "code">("password");
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [codeError, setCodeError] = useState<TextKey | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const [restartNotice, setRestartNotice] = useState<TextKey | null>(null);

  useEffect(() => {
    setSetupDone(new URLSearchParams(location.search).get("setup") === "done");
    let active = true;
    void authClient
      .getSession()
      .then(({ data }) => {
        if (active && data !== null && data !== undefined) location.replace(nextTarget());
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Move focus to the code field when the code step opens or the method changes.
  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step, method]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors = toFieldErrors(parsed);
      setFieldErrors({
        ...(errors.email === undefined ? {} : { email: errors.email as TextKey }),
        ...(errors.password === undefined ? {} : { password: errors.password as TextKey }),
      });
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setRestartNotice(null);
    setPending(true);
    try {
      const { data, error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError === null || signInError === undefined) {
        if (data !== null && data !== undefined && "twoFactorRedirect" in data && data.twoFactorRedirect === true) {
          setPassword("");
          setCode("");
          setCodeError(null);
          setMethod("totp");
          setStep("code");
          setPending(false);
          return;
        }
        location.assign(nextTarget());
        return;
      }
      if (signInError.status === 429) setError("error_too_many");
      else if (signInError.status === 401 || signInError.code === "INVALID_EMAIL_OR_PASSWORD")
        setError("login_error_credentials");
      else setError("error_generic");
    } catch {
      setError("error_generic");
    }
    setPassword("");
    setPending(false);
  }

  function backToPassword(message: TextKey | null) {
    setStep("password");
    setCode("");
    setCodeError(null);
    setMethod("totp");
    setError(null);
    setRestartNotice(message);
  }

  function switchMethod() {
    setMethod(method === "totp" ? "backup" : "totp");
    setCode("");
    setCodeError(null);
  }

  async function onCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = method === "totp" ? cleanTotpCode(code) : cleanBackupCode(code);
    if (clean === null) {
      setCodeError(method === "totp" ? "tf_code_invalid_format" : "tf_backup_invalid_format");
      return;
    }
    setCodeError(null);
    setPending(true);
    try {
      const { error: verifyError } =
        method === "totp"
          ? await authClient.twoFactor.verifyTotp({ code: clean, trustDevice: trust })
          : await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice: trust });
      const failure = codeStepError(verifyError);
      if (failure === null) {
        location.assign(nextTarget());
        return;
      }
      setCode("");
      if (failure.restart) backToPassword(failure.key);
      else setCodeError(failure.key);
    } catch {
      setCode("");
      setCodeError("error_generic");
    }
    setPending(false);
  }

  if (step === "code") {
    const totp = method === "totp";
    const inputId = totp ? "tf-code" : "tf-backup";
    return (
      <AuthCard title="tf_code_title">
        <form method="post" onSubmit={(event) => void onCodeSubmit(event)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>{t(totp ? "tf_code_label" : "tf_backup_label")}</Label>
            <Input
              key={inputId}
              id={inputId}
              name={inputId}
              type="text"
              autoComplete={totp ? "one-time-code" : "off"}
              {...(totp ? { inputMode: "numeric" as const, maxLength: 7 } : {})}
              ref={codeInput}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={codeError !== null}
              aria-describedby={`${inputId}-help`}
            />
            <p id={`${inputId}-help`} className="text-muted-foreground text-sm">
              {t(totp ? "tf_code_help" : "tf_backup_help")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Switch id="tf-trust" checked={trust} onCheckedChange={setTrust} disabled={pending} />
              <Label htmlFor="tf-trust">{t("tf_trust_device")}</Label>
            </div>
            <p className="text-muted-foreground text-sm">{t("tf_trust_help")}</p>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t("tf_verifying") : t("tf_verify")}
          </Button>
          {codeError === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {t(codeError)}
            </p>
          )}
          <Button type="button" variant="link" disabled={pending} onClick={switchMethod}>
            {t(totp ? "tf_use_backup" : "tf_use_app")}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => backToPassword(null)}>
            {t("tf_back")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="login_title">
      {setupDone ? <Alert variant="default">{t("login_setup_done")}</Alert> : null}
      {restartNotice === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {t(restartNotice)}
        </p>
      )}
      <form method="post" onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t("email_label")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email !== undefined}
            aria-describedby={fieldErrors.email === undefined ? undefined : "email-error"}
          />
          {fieldErrors.email === undefined ? null : (
            <p id="email-error" className="text-destructive text-sm">
              {t(fieldErrors.email)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t("password_label")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password !== undefined}
            aria-describedby={fieldErrors.password === undefined ? undefined : "password-error"}
          />
          {fieldErrors.password === undefined ? null : (
            <p id="password-error" className="text-destructive text-sm">
              {t(fieldErrors.password)}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("signing_in") : t("sign_in")}
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-destructive text-sm">
            {t(error)}
          </p>
        )}
      </form>
      <a href="/forgot" className="text-sm underline">
        {t("login_forgot_link")}
      </a>
      <details>
        <summary className="cursor-pointer text-sm">{t("login_help_summary")}</summary>
        <p className="text-muted-foreground mt-2 text-sm">{t("login_help_text")}</p>
      </details>
    </AuthCard>
  );
}
