import type { DelegationFilter, DelegationItem } from "@ea/core/web";
import { useCallback, useRef } from "react";

import { fetchDelegations } from "./delegations-api";
import { mergePages } from "./delegations-view";
import { useReloadOn } from "./use-reload-on";
import { useResource } from "./use-resource";

// The loaded pages of one tab. `filter` names the tab that the items belong to (a change of tab never shows the old items).
export interface LoadedDelegations {
  filter: DelegationFilter;
  items: DelegationItem[];
  next: string | null;
}

// The first `pages` pages, one after the other (a cursor needs the page before it).
export async function loadPages(filter: DelegationFilter, pages: number): Promise<LoadedDelegations> {
  let items: DelegationItem[] = [];
  let next: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    const answer = await fetchDelegations(filter, next);
    items = mergePages(items, answer.items);
    next = answer.next;
    if (next === null) break;
  }
  return { filter, items, next };
}

// A new tab starts at page 1 again: the pages that "Show more" loaded for the old tab must not make the new tab load that many pages.
export function restartPages(pages: { current: number }, reload: () => void): void {
  pages.current = 1;
  reload();
}

// The list reloads every 30 s while the tab is visible and keeps the pages that the user loaded with "Show more". A new tab starts at
// page 1.
export function useDelegationList(filter: DelegationFilter) {
  const pages = useRef(1);
  const resource = useResource(() => loadPages(filter, pages.current));
  const { reload } = resource;
  const restart = useCallback(() => restartPages(pages, reload), [reload]);
  useReloadOn(filter, restart);
  const data = resource.data !== null && resource.data.filter === filter ? resource.data : null;

  // Adds the next page to what is loaded; the reload keeps it from now on.
  const showMore = async (): Promise<DelegationItem[]> => {
    if (data === null || data.next === null) return [];
    const answer = await fetchDelegations(filter, data.next);
    const merged = mergePages(data.items, answer.items);
    pages.current += 1;
    resource.mutate({ filter, items: merged, next: answer.next });
    return merged.slice(data.items.length);
  };

  return { ...resource, data, showMore };
}
