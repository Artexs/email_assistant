import type { DelegationFilter } from "@ea/core/web";
import { useCallback, useEffect, useState } from "react";

import { filterHref, filterOf } from "./delegations-view";

// The tab of `/delegations` is the `filter` query parameter. A choice pushes a history entry (back returns to the earlier tab); browser
// back and forward update the value.
export function useDelegationFilter() {
  const [filter, setFilter] = useState<DelegationFilter>(() => filterOf(location.search));

  useEffect(() => {
    const onPop = () => setFilter(filterOf(location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((next: DelegationFilter) => {
    history.pushState(null, "", filterHref(next));
    setFilter(next);
  }, []);

  return [filter, select] as const;
}
