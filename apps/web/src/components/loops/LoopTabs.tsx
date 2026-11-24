import { cn } from "cn";
import type { MouseEvent } from "react";

import { t } from "../../i18n";
import {
  LOOP_FILTER_LABELS,
  LOOP_TAB_LABELS,
  LOOP_TABS,
  loopFilterHref,
  tabHref,
  type LoopTab,
} from "../../lib/loops-view";
import { loopFilters, type LoopFilterName } from "@ea/core/web";

// A plain click changes the tab without a page load; a click with a modifier key or a middle click keeps the link's own behaviour.
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

// The three kinds of loop. Plain links, each with its address (`?tab=`), so a link keeps the tab.
export function LoopTabs({ current, onSelect }: { current: LoopTab; onSelect(tab: LoopTab): void }) {
  return (
    <nav aria-label={t("lp_tabs_label")} className="flex gap-1 border-b">
      {LOOP_TABS.map((tab) => (
        <a
          key={tab}
          href={tabHref(tab)}
          aria-current={tab === current ? "page" : undefined}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onSelect(tab);
          }}
          className={cn(
            "-mb-px inline-flex min-h-9 items-center border-b-2 px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
            tab === current
              ? "border-primary font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t(LOOP_TAB_LABELS[tab])}
        </a>
      ))}
    </nav>
  );
}

// The states of a Waiting or Promised tab: Open, Due today, Closed.
export function LoopFilterTabs({
  tab,
  current,
  onSelect,
}: {
  tab: LoopTab;
  current: LoopFilterName;
  onSelect(filter: LoopFilterName): void;
}) {
  return (
    <nav aria-label={t("lp_filters_label")} className="flex flex-wrap gap-1">
      {loopFilters.map((filter) => (
        <a
          key={filter}
          href={loopFilterHref(tab, filter)}
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
          {t(LOOP_FILTER_LABELS[filter])}
        </a>
      ))}
    </nav>
  );
}
