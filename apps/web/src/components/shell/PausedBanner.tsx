import { t } from "../../i18n";

export function PausedBanner({ contact }: { contact: string | null }) {
  return (
    <div
      role="status"
      className="border-b border-red-500/50 bg-red-50 px-4 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {contact === null ? t("paused_banner_no_contact") : t("paused_banner", { contact })}
    </div>
  );
}
