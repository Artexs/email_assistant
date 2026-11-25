import type { LoopFilterName } from "@ea/core/web";
import { useCallback, useEffect, useState } from "react";

import { loopFilterHref, loopFilterOf, tabHref, tabOf, type LoopTab } from "./loops-view";

// The tab and the state filter of the "Open loops" page are the query parameters `tab` and `filter`. A choice pushes a history entry
// (back returns to the earlier tab); browser back and forward update the values. The delegation columns on the Delegated tab read the same
// `filter` once at load (`closedOnLoad`) and write nothing.
export function useLoopView() {
  const [view, setView] = useState(() => ({ tab: tabOf(location.search), filter: loopFilterOf(location.search) }));

  useEffect(() => {
    const onPop = () => setView({ tab: tabOf(location.search), filter: loopFilterOf(location.search) });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selectTab = useCallback((tab: LoopTab) => {
    history.pushState(null, "", tabHref(tab));
    setView({ tab, filter: loopFilterOf("") });
  }, []);

  const selectFilter = useCallback(
    (filter: LoopFilterName) => {
      history.pushState(null, "", loopFilterHref(view.tab, filter));
      setView((prev) => ({ ...prev, filter }));
    },
    [view.tab]
  );

  return { tab: view.tab, filter: view.filter, selectTab, selectFilter };
}
