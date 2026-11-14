import { FEW_BACKUP_CODES, twoFactorStatusSchema, type TwoFactorStatus } from "@ea/core/web";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { singleFlight } from "../../lib/single-flight";
import { groupSecret, totpSecretOf } from "../../lib/totp-setup";
import { accountTwoFactorError, cleanTotpCode, type AccountTwoFactorError } from "../../lib/two-factor-errors";
import { useResource } from "../../lib/use-resource";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { TotpQr } from "./TotpQr";

type View = "status" | "password" | "scan" | "codes";
type Purpose = "enable" | "disable" | "codes";
interface FieldError {
  field: "password" | "code";
  key: TextKey;
}

const passwordHelp: Record<Purpose, TextKey> = {
  enable: "tf_password_help_enable",
  codes: "tf_password_help_codes",
  disable: "tf_password_help_disable",
};

// The member's second factor: turn TOTP on (password, QR code, code, backup codes once), see the backup codes left,
// make new ones and turn it off. The setup URI and the codes live only in this component's state: they are never
// logged, stored, put in a URL or shown in a toast, and they are dropped when the section closes or unmounts.
export function TwoFactorSection() {
  const status = useResource(() => api("/api/me/two-factor", twoFactorStatusSchema));
  const [gate] = useState(singleFlight);
  const [view, setView] = useState<View>("status");
  const [purpose, setPurpose] = useState<Purpose>("enable");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [error, setError] = useState<TextKey | null>(null);
  const [withoutCodes, setWithoutCodes] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("two_factor") === "required") {
      document.getElementById("two-factor")?.scrollIntoView();
    }
  }, []);

  function show(failure: AccountTwoFactorError) {
    if (failure.field === null) setError(failure.key);
    else setFieldError({ field: failure.field, key: failure.key });
  }

  function clearErrors() {
    setFieldError(null);
    setError(null);
  }

  function toStatus() {
    setSetup(null);
    setCodes(null);
    setPassword("");
    setCode("");
    clearErrors();
    setView("status");
  }

  function start(next: Purpose) {
    clearErrors();
    setPassword("");
    setPurpose(next);
    setView("password");
  }

  // The enrolment may be stored after a failed verify (fail closed): read the status again and say so when it is on.
  async function afterServerError() {
    toStatus();
    try {
      const fresh = await api("/api/me/two-factor", twoFactorStatusSchema);
      status.mutate(fresh);
      setWithoutCodes(fresh.enabled);
    } catch {
      status.reload();
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await gate(async () => {
      clearErrors();
      setPending(true);
      const typed = password;
      try {
        if (purpose === "enable") {
          const { data, error: authError } = await authClient.twoFactor.enable({ password: typed });
          const failure = accountTwoFactorError(authError);
          if (failure !== null) return show(failure);
          if (data === null || data === undefined || data.method !== "totp") return setError("error_generic");
          const uri = data.totpURI;
          if (totpSecretOf(uri) === null) return setError("error_generic");
          setCode("");
          setSetup({ uri, codes: data.backupCodes });
          setView("scan");
        } else if (purpose === "codes") {
          const { data, error: authError } = await authClient.twoFactor.generateBackupCodes({ password: typed });
          const failure = accountTwoFactorError(authError);
          if (failure !== null) return show(failure);
          if (data === null || data === undefined) return setError("error_generic");
          setWithoutCodes(false);
          setCodes(data.backupCodes);
          setView("codes");
        } else {
          const { error: authError } = await authClient.twoFactor.disable({ password: typed });
          const failure = accountTwoFactorError(authError);
          if (failure !== null) return show(failure);
          toast.success(t("tf_off_toast"));
          toStatus();
          status.reload();
        }
      } catch {
        setError("error_generic");
      } finally {
        setPassword("");
        setPending(false);
      }
    });
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await gate(async () => {
      clearErrors();
      const clean = cleanTotpCode(code);
      if (clean === null || setup === null) return setFieldError({ field: "code", key: "tf_code_invalid_format" });
      setPending(true);
      try {
        const { error: authError } = await authClient.twoFactor.verifyTotp({ code: clean });
        if (authError?.status === 500) return await afterServerError();
        const failure = accountTwoFactorError(authError);
        if (failure !== null) return show(failure);
        toast.success(t("tf_on_toast"));
        setCodes(setup.codes);
        setSetup(null);
        setCode("");
        setView("codes");
        status.reload();
      } catch {
        setError("error_generic");
      } finally {
        setPending(false);
      }
    });
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText((codes ?? []).join("\n"));
      toast.success(t("tf_copied"));
    } catch {
      toast.error(t("tf_copy_failed"));
    }
  }

  function done() {
    toStatus();
    status.reload();
  }

  function renderStatus(data: TwoFactorStatus) {
    const few = data.backupCodesLeft !== null && data.backupCodesLeft <= FEW_BACKUP_CODES;
    if (!data.enabled) {
      return (
        <>
          <p className="text-muted-foreground text-sm">{t("tf_off_text")}</p>
          {data.requiredBy.map((reason) => (
            <Alert key={reason}>{t(reason === "operator" ? "tf_required_operator" : "tf_required_break_glass")}</Alert>
          ))}
          {withoutCodes ? <Alert variant="destructive">{t("tf_on_without_codes")}</Alert> : null}
          <div>
            <Button type="button" onClick={() => start("enable")}>
              {t("tf_turn_on")}
            </Button>
          </div>
        </>
      );
    }
    return (
      <>
        <p className="text-muted-foreground text-sm">{t("tf_on_text")}</p>
        <p className="text-sm">
          {data.backupCodesLeft === null
            ? t("tf_codes_unknown")
            : t("tf_codes_left", { count: String(data.backupCodesLeft) })}
        </p>
        {withoutCodes || few ? (
          <Alert variant="destructive">{t(withoutCodes ? "tf_on_without_codes" : "tf_codes_few")}</Alert>
        ) : null}
        {data.requiredBy.includes("break_glass") ? (
          <p className="text-muted-foreground text-sm">{t("tf_break_glass_note")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => start("codes")}>
            {t("tf_new_codes")}
          </Button>
          <Button type="button" variant="outline" className="text-destructive" onClick={() => start("disable")}>
            {t("tf_turn_off")}
          </Button>
        </div>
      </>
    );
  }

  const secret = setup === null ? null : totpSecretOf(setup.uri);

  return (
    <section id="two-factor" data-section="two-factor" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("tf_title")}</h3>
      {view === "status" ? (
        status.data === null && status.error !== null ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-destructive text-sm">
              {t("load_error_text")}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={status.reload}>
              {t("retry")}
            </Button>
          </div>
        ) : status.data === null || status.loading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          renderStatus(status.data)
        )
      ) : null}
      {view === "password" ? (
        <form method="post" onSubmit={(event) => void submitPassword(event)} noValidate className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{t(passwordHelp[purpose])}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tf-password">{t("password_label")}</Label>
            <Input
              id="tf-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldError?.field === "password"}
              aria-describedby={fieldError?.field === "password" ? "tf-password-error" : undefined}
            />
            {fieldError?.field === "password" ? (
              <p id="tf-password-error" role="alert" className="text-destructive text-sm">
                {t(fieldError.key)}
              </p>
            ) : null}
          </div>
          {error === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {t(error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {t("continue")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={toStatus}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {view === "scan" && setup !== null && secret !== null ? (
        <form method="post" onSubmit={(event) => void submitCode(event)} noValidate className="flex flex-col gap-3">
          <h4 className="text-sm font-medium">{t("tf_scan_title")}</h4>
          <p className="text-muted-foreground text-sm">{t("tf_scan_step_app")}</p>
          <TotpQr uri={setup.uri} />
          <p className="text-muted-foreground text-sm">{t("tf_scan_key")}</p>
          <code data-totp-secret className="font-mono text-sm break-all">
            {groupSecret(secret)}
          </code>
          <a href={setup.uri} className="text-sm underline">
            {t("tf_open_app")}
          </a>
          <p className="text-muted-foreground text-sm">{t("tf_scan_step_code")}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tf-setup-code">{t("tf_code_label")}</Label>
            <Input
              id="tf-setup-code"
              name="one-time-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={fieldError?.field === "code"}
              aria-describedby={fieldError?.field === "code" ? "tf-setup-code-error" : undefined}
            />
            {fieldError?.field === "code" ? (
              <p id="tf-setup-code-error" role="alert" className="text-destructive text-sm">
                {t(fieldError.key)}
              </p>
            ) : null}
          </div>
          {error === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {t(error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {t("tf_verify")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={toStatus}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {view === "codes" && codes !== null ? (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-medium">{t("tf_codes_title")}</h4>
          <p className="text-muted-foreground text-sm">{t("tf_codes_help")}</p>
          <ul data-backup-codes className="grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.map((backupCode) => (
              <li key={backupCode}>{backupCode}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void copyCodes()}>
              {t("tf_copy")}
            </Button>
            <Button type="button" onClick={done}>
              {t("tf_codes_done")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
