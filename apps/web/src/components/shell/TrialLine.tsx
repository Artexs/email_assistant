import { Clock } from "lucide-react";

import { t } from "../../i18n";
import { trialDateText } from "../../lib/trial-date";

export function TrialLine({ endsAt, timeZone }: { endsAt: string; timeZone: string }) {
  return (
    <p className="flex items-center gap-2 text-base text-muted-foreground">
      <Clock aria-hidden="true" className="size-4 shrink-0" />
      <span>{t("trial_ends_on", { date: trialDateText(endsAt, timeZone) })}</span>
    </p>
  );
}
