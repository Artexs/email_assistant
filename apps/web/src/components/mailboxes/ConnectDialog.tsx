import { connectMailboxBodySchema, connectResultSchema, type SmtpSecurity } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n/en";
import { api, ApiError } from "../../lib/api";
import {
  fieldErrorKeys,
  initialConnectForm,
  onAddressChange,
  onProviderChange,
  onSmtpSecurityChange,
  toConnectBody,
  type ConnectFormState,
  type ProviderChoice,
} from "../../lib/connect-form";
import { errorText } from "../../lib/errors";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

export interface ConnectDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(): void;
}

type FieldErrors = ReturnType<typeof fieldErrorKeys>;

const providers = [
  ["interia", "preset_interia"],
  ["gmail", "preset_gmail"],
  ["onet", "preset_onet"],
  ["wp", "preset_wp"],
  ["o2", "preset_o2"],
  ["icloud", "preset_icloud"],
  ["other", "preset_other"],
] as const satisfies readonly (readonly [ProviderChoice, TextKey])[];

const helpTexts = {
  interia: "help_interia",
  gmail: "help_gmail",
  onet: "help_onet",
  wp: "help_wp",
  o2: "help_o2",
  icloud: "help_icloud",
  other: "help_other",
} as const satisfies Record<ProviderChoice, TextKey>;

interface FieldProps {
  id: string;
  label: TextKey;
  value: string;
  error: TextKey | undefined;
  disabled: boolean;
  onChange(value: string): void;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "numeric";
}

function Field({ id, label, value, error, disabled, onChange, type, autoComplete, inputMode }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function ConnectDialog({ open, onOpenChange, onConnected }: ConnectDialogProps) {
  const [form, setForm] = useState<ConnectFormState>(initialConnectForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<TextKey | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setForm(initialConnectForm());
    setFieldErrors({});
    setError(null);
  };

  const changeOpen = (next: boolean) => {
    if (pending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const edit = (patch: Partial<ConnectFormState>) => setForm((state) => ({ ...state, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = toConnectBody(form);
    const parsed = connectMailboxBodySchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(fieldErrorKeys(parsed.error.issues));
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setPending(true);
    try {
      await api("/api/mailboxes", connectResultSchema, { method: "POST", body });
      toast.success(t("connected_toast"));
      reset();
      onConnected();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "validation" && caught.details !== undefined) {
        setFieldErrors(fieldErrorKeys(caught.details));
      } else {
        setError(errorText(caught));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={!pending}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("connect_title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connect-provider">{t("provider_label")}</Label>
            <Select
              value={form.provider}
              disabled={pending}
              onValueChange={(value) => setForm((state) => onProviderChange(state, value as ProviderChoice))}
            >
              <SelectTrigger id="connect-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map(([key, text]) => (
                  <SelectItem key={key} value={key}>
                    {t(text)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{t(helpTexts[form.provider])}</p>
          </div>
          <Field
            id="connect-address"
            label="address_label"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={form.address}
            error={fieldErrors.address}
            disabled={pending}
            onChange={(value) => setForm((state) => onAddressChange(state, value))}
          />
          <Field
            id="connect-password"
            label={form.appPassword ? "mb_app_password_label" : "mb_password_label"}
            type="password"
            autoComplete="off"
            value={form.password}
            error={fieldErrors.password}
            disabled={pending}
            onChange={(value) => edit({ password: value })}
          />
          <div className="flex items-center gap-2">
            <Switch
              id="connect-app-password"
              checked={form.appPassword}
              disabled={pending}
              onCheckedChange={(checked) => edit({ appPassword: checked })}
            />
            <Label htmlFor="connect-app-password">{t("app_password_switch")}</Label>
          </div>
          {form.provider === "other" && (
            <>
              <Field
                id="connect-imap-host"
                label="imap_host_label"
                value={form.imapHost}
                error={fieldErrors.imapHost}
                disabled={pending}
                onChange={(value) => edit({ imapHost: value })}
              />
              <Field
                id="connect-imap-port"
                label="imap_port_label"
                inputMode="numeric"
                value={form.imapPort}
                error={fieldErrors.imapPort}
                disabled={pending}
                onChange={(value) => edit({ imapPort: value })}
              />
              <Field
                id="connect-smtp-host"
                label="smtp_host_label"
                value={form.smtpHost}
                error={fieldErrors.smtpHost}
                disabled={pending}
                onChange={(value) => edit({ smtpHost: value })}
              />
              <Field
                id="connect-smtp-port"
                label="smtp_port_label"
                inputMode="numeric"
                value={form.smtpPort}
                error={fieldErrors.smtpPort}
                disabled={pending}
                onChange={(value) => edit({ smtpPort: value })}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="connect-smtp-security">{t("smtp_security_label")}</Label>
                <Select
                  value={form.smtpSecurity}
                  disabled={pending}
                  onValueChange={(value) => setForm((state) => onSmtpSecurityChange(state, value as SmtpSecurity))}
                >
                  <SelectTrigger id="connect-smtp-security" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">{t("smtp_security_tls")}</SelectItem>
                    <SelectItem value="starttls">{t("smtp_security_starttls")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t("connect_consent")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t(pending ? "checking_login" : "connect_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
