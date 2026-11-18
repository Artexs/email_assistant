import type { TelegramState } from "@ea/core/web";

import { t } from "../../i18n";
import { needsNewTerms } from "../../lib/telegram-consent";
import { Button } from "../ui/button";

export interface NewTermsProps {
  state: Pick<TelegramState, "linked" | "consentVersion">;
  // The registry keys that are on for the organization (`me.features`).
  features: readonly string[];
  busy: boolean;
  onConfirm(): void;
}

// "New Telegram terms: open loops": the consent text and one Confirm button for a linked user whose consent is older than the
// current text. It renders nothing for a current consent.
export function NewTerms({ state, features, busy, onConfirm }: NewTermsProps) {
  if (!needsNewTerms(state, features)) return null;
  return (
    <section aria-labelledby="tg-terms-title" className="flex flex-col items-start gap-2 rounded-md border p-3">
      <h3 id="tg-terms-title" className="text-sm font-medium">
        {t("tgc_title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("tg_consent_text")}</p>
      <Button disabled={busy} onClick={onConfirm}>
        {t("tgc_confirm")}
      </Button>
    </section>
  );
}
