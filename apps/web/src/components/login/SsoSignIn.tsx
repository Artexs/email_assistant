import { useEffect, useReducer, useRef, type FormEvent } from "react";

import { t } from "../../i18n";
import { ssoFormReducer, ssoFormStart, type SsoFormState } from "../../lib/sso-form";
import { checkSsoEmail, startSsoSignIn } from "../../lib/sso-sign-in";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface ViewProps {
  state: SsoFormState;
  onOpen: () => void;
  onBack: () => void;
  onEmail: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

// The markup only; the state and the effects are in `SsoSignIn`. Tests render it with a given state.
export function SsoView({ state, onOpen, onBack, onEmail, onSubmit, inputRef, buttonRef }: ViewProps) {
  const { open, email, pending, error } = state;
  if (!open) {
    return (
      <div className="flex flex-col gap-2" data-block="sso">
        <p className="text-muted-foreground text-sm">{t("login_sso_hint")}</p>
        <Button type="button" variant="outline" ref={buttonRef} onClick={onOpen}>
          {t("login_sso_button")}
        </Button>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-block="sso">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sso-email">{t("login_sso_email")}</Label>
        <Input
          id="sso-email"
          name="sso-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          ref={inputRef}
          required
          value={email}
          onChange={(event) => onEmail(event.target.value)}
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
      <Button type="button" variant="link" disabled={pending} onClick={onBack}>
        {t("login_sso_back")}
      </Button>
    </form>
  );
}

// The company sign-in block of the login page. The page renders it only when `GET /api/sign-in-options` said `sso: true`.
// `next` is a path that `safeNextPath` already checked.
export function SsoSignIn({ next }: { next: string }) {
  const [state, dispatch] = useReducer(ssoFormReducer, ssoFormStart);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Do each focus request once: the e-mail field when the form opens, the opening button when the form closes.
  useEffect(() => {
    if (state.focus === "email") input.current?.focus();
    else if (state.focus === "button") button.current?.focus();
  }, [state.focus, state.focusSeq]);

  // After `location.assign` the page may come back from the browser cache with the request still marked as running.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) dispatch({ type: "restored" });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkSsoEmail(state.email);
    if (!checked.ok) {
      dispatch({ type: "invalid", key: checked.key });
      return;
    }
    dispatch({ type: "start" });
    const result = await startSsoSignIn(checked.email, next, location.origin);
    if (result.ok) {
      location.assign(result.url);
      return;
    }
    dispatch({ type: "failed", key: result.key });
  }

  return (
    <SsoView
      state={state}
      onOpen={() => dispatch({ type: "open" })}
      onBack={() => dispatch({ type: "back" })}
      onEmail={(value) => dispatch({ type: "email", value })}
      onSubmit={(event) => void onSubmit(event)}
      inputRef={input}
      buttonRef={button}
    />
  );
}
