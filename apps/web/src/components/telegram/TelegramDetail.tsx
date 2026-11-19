import {
  TELEGRAM_CONSENT_VERSION,
  telegramDetailAnswerSchema,
  type TelegramDetail as Detail,
  type TelegramState,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

// The Telegram detail level: the two choices with their words (the link step and the change dialog), and the linked card's line with
// the change button. The server decides (`effectiveDetail`, the lock); the panel shows its answer. The choice shows only while the
// flag `telegram_minimal` is on: the server then adds `detail` to the state, and without the key none of this renders.

const options: { value: Detail; label: TextKey; text: TextKey }[] = [
  { value: "minimal", label: "tgd_minimal_option", text: "tgd_minimal_text" },
  { value: "full", label: "tgd_full_option", text: "tgd_full_text" },
];

/** The level that the link step and the dialog preselect: the stored one, but `minimal` while the lock is on. */
export function preselectedDetail(state: Pick<TelegramState, "detail" | "locked">): Detail {
  return state.locked === true ? "minimal" : (state.detail ?? "minimal");
}

interface ChoiceProps {
  name: string;
  value: Detail;
  locked: boolean;
  disabled: boolean;
  onChange(value: Detail): void;
}

export function TelegramDetailChoice({ name, value, locked, disabled, onChange }: ChoiceProps) {
  return (
    <fieldset data-section="telegram-detail" className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t("tgd_title")}</legend>
      {options.map((option) => {
        const off = disabled || (locked && option.value === "full");
        return (
          <div key={option.value} className="flex items-start gap-2">
            <input
              type="radio"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              className="accent-primary mt-0.5 size-4"
              checked={value === option.value}
              disabled={off}
              aria-describedby={`${name}-${option.value}-text`}
              onChange={() => onChange(option.value)}
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`${name}-${option.value}`}>{t(option.label)}</Label>
              <p id={`${name}-${option.value}-text`} className="text-sm text-muted-foreground">
                {t(option.text)}
              </p>
            </div>
          </div>
        );
      })}
      {locked && <p className="text-sm text-muted-foreground">{t("tgd_locked")}</p>}
    </fieldset>
  );
}

const shortLabels: Record<Detail, TextKey> = { minimal: "tgd_minimal_short", full: "tgd_full_short" };

interface LinkedProps {
  state: TelegramState & { detail: Detail };
  busy: boolean;
  onChanged(): void;
}

// The linked card: what Telegram gets now, and a dialog to change it. `full` needs the consent tick again (the server refuses without it).
export function TelegramDetailLinked({ state, busy, onChanged }: LinkedProps) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Detail>(preselectedDetail(state));
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = state.locked === true;
  const shown = state.effectiveDetail ?? state.detail;
  const needsConsent = choice === "full" && state.detail !== "full";
  const unchanged = choice === state.detail;

  const openDialog = () => {
    setChoice(preselectedDetail(state));
    setAgreed(false);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/me/telegram-detail", telegramDetailAnswerSchema, {
        method: "PATCH",
        body: choice === "full" ? { detail: choice, consentVersion: TELEGRAM_CONSENT_VERSION } : { detail: choice },
      });
      setOpen(false);
      toast.success(t("tgd_saved_toast"));
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setSaving(false);
      // A refusal (the lock, an old consent text) also changes what the card should show: read it again.
      onChanged();
    }
  };

  return (
    <div data-section="telegram-detail-linked" className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          <span className="text-muted-foreground">{t("tgd_current_label")} </span>
          <span data-detail={shown} className="font-medium">
            {t(shortLabels[shown])}
          </span>
        </p>
        <Button variant="outline" disabled={busy} onClick={openDialog}>
          {t("tgd_change")}
        </Button>
      </div>
      {locked && state.detail === "full" && <p className="text-sm text-muted-foreground">{t("tgd_locked_now")}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("tgd_change_title")}</DialogTitle>
          </DialogHeader>
          <TelegramDetailChoice
            name="tgd-change"
            value={choice}
            locked={locked}
            disabled={saving}
            onChange={setChoice}
          />
          {needsConsent && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("tg_consent_title")}</h3>
              <p className="text-sm text-muted-foreground">{t("tg_consent_text")}</p>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="tgd-consent"
                  className="accent-primary mt-0.5 size-4"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                <Label htmlFor="tgd-consent">{t("tg_consent_label")}</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={saving || busy || unchanged || (needsConsent && !agreed)} onClick={() => void save()}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
