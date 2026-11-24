import type { DelegationFilter, DelegationItem, DelegationList } from "@ea/core/web";
import { useCallback, useEffect, useRef } from "react";

import { ApiError } from "./api";
import { DELEGATION_GROUP_OF, GROUP_FEED, placeRows, type DelegationGroup } from "./delegation-columns";
import { fetchDelegations } from "./delegations-api";
import { mergePages } from "./delegations-view";
import { loadPages } from "./use-delegation-list";
import { useReloadOn } from "./use-reload-on";
import { useResource } from "./use-resource";

// One list of the server: the rows loaded so far, the cursor of the next page, how many pages they came from, and the last failure.
export interface FeedState {
  items: DelegationItem[];
  next: string | null;
  pages: number;
  error: unknown | null;
}

type Feeds = Partial<Record<DelegationFilter, FeedState>>;

// The feeds that load first, in page order. `closed` joins them only while its list is open.
const FIRST_FEEDS: readonly DelegationFilter[] = ["open", "overdue", "answered"];

// What a reload fetches: each feed as far as the user loaded it (page 1 when it never loaded), `closed` only while its list is open.
export function reloadPlan(feeds: Feeds, closedOpen: boolean): { filter: DelegationFilter; pages: number }[] {
  const filters = closedOpen ? [...FIRST_FEEDS, "closed" as const] : FIRST_FEEDS;
  return filters.map((filter) => ({ filter, pages: feeds[filter]?.pages ?? 1 }));
}

// Loads open pages until one adds a row of `column`, the cursor ends, or `maxPages` pages came. Drafted and sent rows share one cursor, so
// a page can hold only rows of the other column.
export async function loadUntilGain(
  column: "drafted" | "sent",
  feed: FeedState,
  fetch: (before: string) => Promise<DelegationList>,
  maxPages = 4
): Promise<FeedState> {
  let state = feed;
  for (let call = 0; call < maxPages && state.next !== null; call += 1) {
    const known = new Set(state.items.filter((item) => item.status === column).map((item) => item.id));
    const answer = await fetch(state.next);
    const items = mergePages(state.items, answer.items);
    state = { items, next: answer.next, pages: state.pages + 1, error: null };
    if (items.some((item) => item.status === column && !known.has(item.id))) break;
  }
  return state;
}

const EMPTY_FEED: FeedState = { items: [], next: null, pages: 1, error: null };

// A feed that failed keeps its rows; the error shows in its columns only.
async function loadFeed(filter: DelegationFilter, pages: number, before: FeedState | undefined): Promise<FeedState> {
  try {
    const loaded = await loadPages(filter, pages);
    return { items: loaded.items, next: loaded.next, pages, error: null };
  } catch (error) {
    return { ...(before ?? EMPTY_FEED), error };
  }
}

const isNotFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

// The four feeds of the delegations page, reloaded every 30 s with the pages the user loaded. `closed` loads while its list is open.
export function useDelegationColumns(options: { closedOpen: boolean }) {
  const { closedOpen } = options;
  const closedRef = useRef(closedOpen);
  useEffect(() => {
    closedRef.current = closedOpen;
  });
  const feedsRef = useRef<Feeds>({});

  const resource = useResource<Feeds>(async () => {
    const before = feedsRef.current;
    const plan = reloadPlan(before, closedRef.current);
    const loaded = await Promise.all(plan.map(({ filter, pages }) => loadFeed(filter, pages, before[filter])));
    const next: Feeds = { ...before };
    plan.forEach(({ filter }, index) => {
      next[filter] = loaded[index];
    });
    feedsRef.current = next;
    return next;
  });
  const { reload, mutate } = resource;
  useReloadOn(closedOpen, reload);

  const feeds: Feeds = resource.data ?? {};
  const groups = placeRows({
    open: feeds.open?.items,
    overdue: feeds.overdue?.items,
    answered: feeds.answered?.items,
    closed: feeds.closed?.items,
  });
  const flagOff = Object.values(feeds).some((feed) => isNotFound(feed.error));

  const store = useCallback(
    (filter: DelegationFilter, feed: FeedState) => {
      feedsRef.current = { ...feedsRef.current, [filter]: feed };
      mutate(feedsRef.current);
    },
    [mutate]
  );

  // Loads the feed of a failed column again, as far as it was loaded.
  const retry = useCallback(
    async (filter: DelegationFilter) => {
      const before = feedsRef.current[filter];
      store(filter, await loadFeed(filter, before?.pages ?? 1, before));
    },
    [store]
  );

  // Loads more rows for a group and returns the rows that the group gained. Drafted and sent load open pages until the clicked column
  // gains a row; the other groups load one page.
  const showMore = async (group: DelegationGroup): Promise<DelegationItem[]> => {
    const filter = GROUP_FEED[group];
    const feed = feedsRef.current[filter];
    if (feed === undefined || feed.next === null) return [];
    const inGroup = (item: DelegationItem) => DELEGATION_GROUP_OF[item.status] === group;
    const seen = new Set(feed.items.filter(inGroup).map((item) => item.id));
    let grown: FeedState;
    try {
      if (group === "drafted" || group === "sent") {
        grown = await loadUntilGain(group, feed, (before) => fetchDelegations(filter, before));
      } else {
        const answer = await fetchDelegations(filter, feed.next);
        grown = { items: mergePages(feed.items, answer.items), next: answer.next, pages: feed.pages + 1, error: null };
      }
    } catch (error) {
      store(filter, { ...feed, error });
      return [];
    }
    store(filter, grown);
    return grown.items.filter((item) => inGroup(item) && !seen.has(item.id));
  };

  return {
    feeds,
    groups,
    flagOff,
    loading: resource.loading,
    reload,
    retry: (filter: DelegationFilter) => void retry(filter),
    showMore,
  };
}
