import { t } from "../../i18n";
import { trialDateText } from "../../lib/trial-date";

export function TrialLine({ endsAt, timeZone }: { endsAt: string; timeZone: string }) {
  return (
    <p className="px-4 py-2 text-sm text-muted-foreground">
      {t("trial_ends_on", { date: trialDateText(endsAt, timeZone) })}
    </p>
  );
}
