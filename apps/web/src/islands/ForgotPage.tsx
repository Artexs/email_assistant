import { fieldErrors as toFieldErrors, forgotFormSchema } from "@ea/core/web";
import { useState, type FormEvent } from "react";

import { AuthCard } from "../components/auth/AuthCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { t, type TextKey, useLocale } from "../i18n";
import { requestPasswordReset } from "../lib/auth-requests";

type Outcome = "sent" | "off" | null;

export default function ForgotPage() {
  useLocale();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<TextKey | null>(null);
  const [error, setError] = useState<TextKey | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = forgotFormSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError((toFieldErrors(parsed).email ?? "email_invalid") as TextKey);
      setError(null);
      return;
    }
    setFieldError(null);
    setError(null);
    setPending(true);
    const result = await requestPasswordReset(parsed.data.email);
    setPending(false);
    if (result === "sent" || result === "off") setOutcome(result);
    else setError(result === "too_many" ? "error_too_many" : "error_generic");
  }

  if (outcome !== null) {
    return (
      <AuthCard title="forgot_title">
        <p role={outcome === "off" ? "alert" : "status"}>{t(outcome === "off" ? "forgot_off" : "forgot_sent")}</p>
        <a href="/login" className="underline">
          {t("go_to_sign_in")}
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="forgot_title">
      <p className="text-muted-foreground text-sm">{t("forgot_text")}</p>
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
            aria-invalid={fieldError !== null}
            aria-describedby={fieldError === null ? undefined : "email-error"}
          />
          {fieldError === null ? null : (
            <p id="email-error" className="text-destructive text-sm">
              {t(fieldError)}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("forgot_sending") : t("forgot_send")}
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
