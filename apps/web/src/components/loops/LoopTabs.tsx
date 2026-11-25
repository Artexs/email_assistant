import { t } from "../../i18n";
import {
  LOOP_FILTER_LABELS,
  LOOP_TAB_LABELS,
  LOOP_TABS,
  loopFilterHref,
  tabHref,
  type LoopTab,
} from "../../lib/loops-view";
import { PillNav } from "../delegation/PillNav";
import { loopFilters, type LoopFilterName } from "@ea/core/web";

// The three kinds of loop. Plain links, each with its address (`?tab=`), so a link keeps the tab.
export function LoopTabs({ current, onSelect }: { current: LoopTab; onSelect(tab: LoopTab): void }) {
  return (
    <PillNav
      label={t("lp_tabs_label")}
      items={LOOP_TABS.map((tab) => ({ key: tab, href: tabHref(tab), label: t(LOOP_TAB_LABELS[tab]) }))}
      current={current}
      onSelect={onSelect}
    />
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
    <PillNav
      label={t("lp_filters_label")}
      items={loopFilters.map((filter) => ({
        key: filter,
        href: loopFilterHref(tab, filter),
        label: t(LOOP_FILTER_LABELS[filter]),
      }))}
      current={current}
      onSelect={onSelect}
    />
  );
}
