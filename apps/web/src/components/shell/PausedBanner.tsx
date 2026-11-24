import { t } from "../../i18n";

export function PausedBanner({ contact }: { contact: string | null }) {
  return (
    <div role="status" className="border-b bg-destructive-soft px-4 py-2 text-sm text-destructive">
      {contact === null ? t("paused_banner_no_contact") : t("paused_banner", { contact })}
    </div>
  );
}
