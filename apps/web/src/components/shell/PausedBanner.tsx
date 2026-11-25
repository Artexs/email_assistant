import { CirclePause } from "lucide-react";

import { t } from "../../i18n";

export function PausedBanner({ contact }: { contact: string | null }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md bg-destructive-soft px-4 py-3 text-base text-destructive"
    >
      <CirclePause aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <p className="min-w-0">{contact === null ? t("paused_banner_no_contact") : t("paused_banner", { contact })}</p>
    </div>
  );
}
