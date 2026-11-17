import type { LoopFilterName, LoopItem, LoopKindName } from "@ea/core/web";
import { useCallback, useRef } from "react";

import { fetchLoops } from "./loops-api";
import { mergeLoopPages } from "./loops-view";
import { useReloadOn } from "./use-reload-on";
import { useResource } from "./use-resource";

// The loaded pages of one list. `kind` and `filter` name the list that the items belong to (a change of tab never shows the old items).
export interface LoadedLoops {
  kind: LoopKindName;
  filter: LoopFilterName;
  items: LoopItem[];
  next: string | null;
}

// The first `pages` pages, one after the other (a cursor needs the page before it).
export async function loadLoopPages(kind: LoopKindName, filter: LoopFilterName, pages: number): Promise<LoadedLoops> {
  let items: LoopItem[] = [];
  let next: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    const answer = await fetchLoops(kind, filter, next);
    items = mergeLoopPages(items, answer.items);
    next = answer.next;
    if (next === null) break;
  }
  return { kind, filter, items, next };
}

// The list reloads every 30 s while the tab is visible and keeps the pages that the user loaded with "Show more". A new list (another
// kind or filter) starts at page 1 again.
export function useLoopList(kind: LoopKindName, filter: LoopFilterName) {
  const pages = useRef(1);
  const resource = useResource(() => loadLoopPages(kind, filter, pages.current));
  const { reload } = resource;
  const restart = useCallback(() => {
    pages.current = 1;
    reload();
  }, [reload]);
  useReloadOn(`${kind}:${filter}`, restart);
  const data =
    resource.data !== null && resource.data.kind === kind && resource.data.filter === filter ? resource.data : null;

  // Adds the next page to what is loaded; the reload keeps it from now on.
  const showMore = async (): Promise<LoopItem[]> => {
    if (data === null || data.next === null) return [];
    const answer = await fetchLoops(kind, filter, data.next);
    const merged = mergeLoopPages(data.items, answer.items);
    pages.current += 1;
    resource.mutate({ kind, filter, items: merged, next: answer.next });
    return merged.slice(data.items.length);
  };

  return { ...resource, data, showMore };
}
