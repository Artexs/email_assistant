import { fieldErrors as toFieldErrors, loginFormSchema } from "@ea/core/web";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "../components/auth/AuthCard";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { t, type TextKey } from "../i18n/en";
import { authClient } from "../lib/auth-client";
import { safeNextPath } from "../lib/next-path";

type FieldErrors = Partial<Record<"email" | "password", TextKey>>;

function nextTarget(): string {
  return safeNextPath(new URLSearchParams(location.search).get("next"));
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [setupDone, setSetupDone] = useState(false);

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
    setPending(true);
    try {
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError === null || signInError === undefined) {
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

  return (
    <AuthCard title="login_title">
      {setupDone ? <Alert variant="default">{t("login_setup_done")}</Alert> : null}
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
      <details>
        <summary className="cursor-pointer text-sm">{t("login_help_summary")}</summary>
        <p className="text-muted-foreground mt-2 text-sm">{t("login_help_text")}</p>
      </details>
    </AuthCard>
  );
}
