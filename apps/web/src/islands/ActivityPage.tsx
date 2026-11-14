import { formatClock, mailboxListSchema } from "@ea/core/web";
import { useCallback, useState } from "react";

import { ActivityFilterBar } from "../components/activity/ActivityFilterBar";
import { ActivityList, ActivitySkeleton } from "../components/activity/ActivityList";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { Button } from "../components/ui/button";
import { t } from "../i18n";
import { filtersFromSearch, filtersToSearch, type ActivityFilters } from "../lib/activity-filters";
import { api } from "../lib/api";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

function Activity() {
  const { me } = useMe();
  const now = useNow();
  // AppShell renders its children only after /api/me loaded, so this runs in the browser only.
  const [filters, setFilters] = useState<ActivityFilters>(() => filtersFromSearch(location.search));
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const mailboxes = useResource(() => api("/api/mailboxes", mailboxListSchema));
  const onLoaded = useCallback((at: Date) => setLastLoad(at), []);

  if (me === null) return null;
  const timeZone = me.organization.timezone;
  const list = mailboxes.data ?? [];

  // Derived, not stored: a mailbox that is not in the loaded list counts as "all".
  const effective: ActivityFilters = {
    ...filters,
    mailboxId:
      list.length >= 2 && filters.mailboxId !== null && list.some((mailbox) => mailbox.id === filters.mailboxId)
        ? filters.mailboxId
        : null,
  };
  const waitingForMailboxes = filters.mailboxId !== null && mailboxes.data === null && mailboxes.error === null;

  const onChange = (next: ActivityFilters) => {
    setFilters(next);
    setLastLoad(null);
    history.replaceState(null, "", `${location.pathname}${filtersToSearch(next)}${location.hash}`);
  };

  const addressOf = (id: string) => list.find((mailbox) => mailbox.id === id)?.address ?? null;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ActivityFilterBar filters={effective} mailboxes={list} onChange={onChange} />
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {lastLoad !== null && t("updated_at", { time: formatClock(lastLoad, timeZone, now) })}
          </p>
          <Button variant="outline" onClick={() => setRefreshSignal((n) => n + 1)}>
            {t("refresh")}
          </Button>
        </div>
      </div>
      {waitingForMailboxes ? (
        <ActivitySkeleton />
      ) : (
        <ActivityList
          key={filtersToSearch(effective)}
          filters={effective}
          timeZone={timeZone}
          showMailbox={list.length >= 2}
          mailboxAddress={addressOf}
          hasMailbox={me.mailboxCount > 0}
          onLoaded={onLoaded}
          refreshSignal={refreshSignal}
        />
      )}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <AppShell active="activity" title="title_activity">
      <Activity />
    </AppShell>
  );
}
