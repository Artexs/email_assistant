import { securityLogSchema } from "@ea/core/web";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import { securityLineText } from "../../lib/security-log-text";
import { useResource } from "../../lib/use-resource";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

// The registry events of the organization, newest first. The server limits the rows (50, 90 days).
export function SecurityLog({ timeZone }: { timeZone: string }) {
  const { data, error, loading, reload } = useResource(() => api("/api/security-log", securityLogSchema));
  return (
    <section data-section="security-log" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("sec_title")}</h3>
      <p className="text-muted-foreground text-sm">{t("sec_help")}</p>
      {data === null && error !== null ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-destructive text-sm">
            {t("load_error_text")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t("retry")}
          </Button>
        </div>
      ) : data === null || loading ? (
        <Skeleton className="h-12 w-full" />
      ) : data.entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("sec_empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.entries.map((entry) => (
            <li key={`${entry.at}-${entry.kind}`} className="rounded-md border p-3 text-sm">
              {securityLineText(entry, timeZone)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
