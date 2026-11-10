import { fieldErrors as toFieldErrors, setPasswordFormSchema } from "@ea/core/web";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "../components/auth/AuthCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { t, type TextKey } from "../i18n/en";
import { authClient } from "../lib/auth-client";

type Mode = "form" | "invalid" | "missing";
type Field = "email" | "password" | "repeat";
type FieldErrors = Partial<Record<Field, TextKey>>;

export default function SetupPage() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("form");
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<TextKey | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linkToken = params.get("token");
    setToken(linkToken);
    if (params.get("error") !== null) setMode("invalid");
    else if (linkToken === null) setMode("missing");
    else setMode("form");
    setMounted(true);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    const parsed = setPasswordFormSchema.safeParse({ email, password, repeat });
    if (!parsed.success) {
      const errors = toFieldErrors(parsed);
      const next: FieldErrors = {};
      for (const field of ["email", "password", "repeat"] as const) {
        if (errors[field] !== undefined) next[field] = errors[field] as TextKey;
      }
      setFieldErrors(next);
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setPending(true);
    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
      if (resetError !== null && resetError !== undefined) {
        if (resetError.code === "INVALID_TOKEN") setMode("invalid");
        else if (resetError.status === 429) setError("error_too_many");
        else setError("error_generic");
        setPending(false);
        return;
      }
    } catch {
      setError("error_generic");
      setPending(false);
      return;
    }
    // The token is used now: a sign-in failure goes to the login page, not to an error.
    try {
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error === null || signIn.error === undefined) {
        location.assign("/");
        return;
      }
    } catch {
      // Fall through to the login page.
    }
    location.assign("/login?setup=done");
  }

  if (!mounted) return null;

  if (mode !== "form") {
    return (
      <AuthCard title="setup_title">
        <p role="alert">{t(mode === "invalid" ? "setup_link_invalid" : "setup_link_missing")}</p>
        <a href="/login" className="underline">
          {t("go_to_sign_in")}
        </a>
      </AuthCard>
    );
  }

  const describedBy = (field: Field, extra?: string) => {
    const ids = [extra, fieldErrors[field] === undefined ? undefined : `${field}-error`].filter(Boolean);
    return ids.length === 0 ? undefined : ids.join(" ");
  };
  const errorText = (field: Field) => {
    const key = fieldErrors[field];
    return key === undefined ? null : (
      <p id={`${field}-error`} className="text-destructive text-sm">
        {t(key)}
      </p>
    );
  };

  return (
    <AuthCard title="setup_title">
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
            aria-describedby={describedBy("email")}
          />
          {errorText("email")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t("new_password_label")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password !== undefined}
            aria-describedby={describedBy("password", "password-help")}
          />
          <p id="password-help" className="text-muted-foreground text-sm">
            {t("password_help")}
          </p>
          {errorText("password")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="repeat">{t("repeat_password_label")}</Label>
          <Input
            id="repeat"
            name="repeat"
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            aria-invalid={fieldErrors.repeat !== undefined}
            aria-describedby={describedBy("repeat")}
          />
          {errorText("repeat")}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("setting_password") : t("set_password")}
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-destructive text-sm">
            {t(error)}
          </p>
        )}
      </form>
    </AuthCard>
  );
}
