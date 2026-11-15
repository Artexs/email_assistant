import { useEffect, useRef, useState, type FormEvent } from "react";

import { t, type TextKey } from "../../i18n";
import { checkSsoEmail, startSsoSignIn } from "../../lib/sso-sign-in";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// The company sign-in block of the login page (F119 D14). The page renders it only when `GET /api/sign-in-options` said `sso: true`.
// `next` is a path that `safeNextPath` already checked.
export function SsoSignIn({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Move focus to the field when the form opens.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkSsoEmail(email);
    if (!checked.ok) {
      setError(checked.key);
      return;
    }
    setError(null);
    setPending(true);
    const result = await startSsoSignIn(checked.email, next, location.origin);
    if (result.ok) {
      location.assign(result.url);
      return;
    }
    setError(result.key);
    setPending(false);
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2" data-block="sso">
        <p className="text-muted-foreground text-sm">{t("login_sso_hint")}</p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {t("login_sso_button")}
        </Button>
      </div>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-4"
      data-block="sso"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="sso-email">{t("login_sso_email")}</Label>
        <Input
          id="sso-email"
          name="sso-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          ref={input}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "sso-error"}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("signing_in") : t("login_sso_submit")}
      </Button>
      {error === null ? null : (
        <p id="sso-error" role="alert" className="text-destructive text-sm">
          {t(error)}
        </p>
      )}
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        {t("login_sso_back")}
      </Button>
    </form>
  );
}
