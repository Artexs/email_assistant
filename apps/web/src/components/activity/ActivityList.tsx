import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { activityQueryString, type ActivityFilters } from "../../lib/activity-filters";
import { useActivityList } from "../../lib/use-activity-list";
import { useNow } from "../../lib/use-now";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ActivityPanel } from "./ActivityPanel";
import { ActivityRow } from "./ActivityRow";

export interface ActivityListProps {
  filters: ActivityFilters;
  timeZone: string;
  showMailbox: boolean; // two or more mailboxes
  mailboxAddress(id: string): string | null;
  hasMailbox: boolean; // me.mailboxCount > 0
  onLoaded(at: Date): void; // the page shows "Updated HH:MM"
  refreshSignal: number; // the page's Refresh button increments it
}

export function ActivityList({
  filters,
  timeZone,
  showMailbox,
  mailboxAddress,
  hasMailbox,
  onLoaded,
  refreshSignal,
}: ActivityListProps) {
  const now = useNow();
  const { state, refresh, loadMore, patch } = useActivityList(
    (before) => activityQueryString(filters, new Date(), before),
    {
      onLoadMoreError: () => toast.error(t("error_generic")),
    }
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derived in render: when the mail leaves the list, the panel closes.
  const selected = state.items.find((i) => i.emailId === selectedId) ?? null;

  // The first render does not refresh: the hook loads the first page itself.
  const seenSignal = useRef(refreshSignal);
  useEffect(() => {
    if (seenSignal.current === refreshSignal) return;
    seenSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  const { lastLoad } = state;
  useEffect(() => {
    if (lastLoad !== null) onLoaded(lastLoad);
  }, [lastLoad, onLoaded]);

  if (state.items.length === 0 && state.status === "loading") return <ActivitySkeleton />;
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("act_load_error")}</p>
        <Button onClick={refresh}>{t("retry")}</Button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("act_empty")}</p>
        {!hasMailbox && (
          <>
            <p className="text-muted-foreground">{t("act_no_mailbox")}</p>
            <Button asChild variant="outline">
              <a href="/mailboxes">{t("act_open_mailboxes")}</a>
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.refreshError && (
        <p className="text-sm text-muted-foreground">
          {t("act_refresh_error")}{" "}
          <Button variant="link" className="h-auto p-0" onClick={refresh}>
            {t("retry")}
          </Button>
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-md border">
        {state.items.map((item) => (
          <li key={item.emailId} data-email-id={item.emailId} className="px-3 py-3">
            <ActivityRow
              item={item}
              timeZone={timeZone}
              now={now}
              mailboxAddress={showMailbox ? mailboxAddress(item.mailboxId) : null}
              onOpen={setSelectedId}
              onPatch={patch}
              onGone={refresh}
            />
          </li>
        ))}
      </ul>
      <ActivityPanel
        item={selected}
        timeZone={timeZone}
        now={now}
        mailboxAddress={selected !== null && showMailbox ? mailboxAddress(selected.mailboxId) : null}
        onClose={() => setSelectedId(null)}
        onPatch={patch}
        onGone={refresh}
      />
      {state.nextBefore !== null && (
        <Button variant="outline" className="self-center" disabled={state.loadingMore} onClick={loadMore}>
          {t("act_load_more")}
        </Button>
      )}
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
