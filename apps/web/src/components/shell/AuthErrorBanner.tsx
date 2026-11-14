import { t, tp } from "../../i18n";

export function AuthErrorBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <span>{tp("auth_error_banner", count)}</span>
      <a href="/mailboxes" className="font-medium underline">
        {t("auth_error_banner_link")}
      </a>
    </div>
  );
}
