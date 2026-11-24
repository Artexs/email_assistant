import { TriangleAlert } from "lucide-react";

import { t, tp } from "../../i18n";

export function AuthErrorBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md bg-accent px-4 py-3 text-base text-accent-foreground"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span>{tp("auth_error_banner", count)}</span>
        <a href="/mailboxes" className="font-bold underline">
          {t("auth_error_banner_link")}
        </a>
      </div>
    </div>
  );
}
