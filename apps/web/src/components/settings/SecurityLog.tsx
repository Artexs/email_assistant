import { securityLogSchema } from "@ea/core/web";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import { securityEntryParts } from "../../lib/security-log-text";
import { useResource } from "../../lib/use-resource";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

// The registry events of the organization, newest first. The server limits the rows (50, 90 days).
export function SecurityLog({ timeZone }: { timeZone: string }) {
  const { data, error, loading, reload } = useResource(() => api("/api/security-log", securityLogSchema));
  return (
    <section data-section="security-log" className="flex flex-col gap-3">
      <h3 className="text-base font-bold">{t("sec_title")}</h3>
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
        <RowList>
          {data.entries.map((entry) => {
            const { when, what, who } = securityEntryParts(entry, timeZone);
            return (
              <Row
                key={`${entry.at}-${entry.kind}`}
                leading={
                  <time dateTime={entry.at} className="block w-24 text-sm tabular-nums text-muted-foreground">
                    {when}
                  </time>
                }
                title={what}
                hint={who}
              />
            );
          })}
        </RowList>
      )}
    </section>
  );
}
