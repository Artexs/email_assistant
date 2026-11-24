import { delegationFilters, type DelegationFilter } from "@ea/core/web";
import { cn } from "cn";
import type { MouseEvent } from "react";

import { t } from "../../i18n";
import { FILTER_LABELS, filterHref } from "../../lib/delegations-view";

// A plain click changes the tab without a page load; a click with a modifier key or a middle click keeps the link's own behaviour.
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

// The states of the dashboard. Plain links, each with its address (`?filter=`), so a link keeps the tab.
export function DelegationFilterTabs({
  current,
  onSelect,
}: {
  current: DelegationFilter;
  onSelect(filter: DelegationFilter): void;
}) {
  return (
    <nav aria-label={t("dgn_filters_label")} className="flex flex-wrap gap-1">
      {delegationFilters.map((filter) => (
        <a
          key={filter}
          href={filterHref(filter)}
          aria-current={filter === current ? "page" : undefined}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onSelect(filter);
          }}
          className={cn(
            "inline-flex min-h-9 items-center rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
            filter === current
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t(FILTER_LABELS[filter])}
        </a>
      ))}
    </nav>
  );
}
