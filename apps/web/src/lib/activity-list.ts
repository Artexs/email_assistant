import type { ActivityItem, ActivityWebPage } from "@ea/core/web";

export interface ActivityListState {
  items: ActivityItem[];
  nextBefore: string | null;
  olderLoaded: boolean;
  status: "loading" | "ready" | "error";
  refreshError: boolean;
  loadingMore: boolean;
  lastLoad: Date | null;
}

export const INITIAL_LIST: ActivityListState = {
  items: [],
  nextBefore: null,
  olderLoaded: false,
  status: "loading",
  refreshError: false,
  loadingMore: false,
  lastLoad: null,
};

// The server order: received_at DESC, then id DESC. A negative result means `a` comes first.
export function compareKey(a: ActivityItem, b: ActivityItem): number {
  const byTime = Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
  if (byTime !== 0) return byTime;
  if (a.emailId === b.emailId) return 0;
  return a.emailId < b.emailId ? 1 : -1;
}

export function firstPage(page: ActivityWebPage, at: Date): ActivityListState {
  return {
    items: page.items,
    nextBefore: page.nextBefore,
    olderLoaded: false,
    status: "ready",
    refreshError: false,
    loadingMore: false,
    lastLoad: at,
  };
}

export function mergePolled(state: ActivityListState, page: ActivityWebPage, at: Date): ActivityListState {
  const last = page.items.at(-1);
  if ((!state.olderLoaded && !state.loadingMore) || last === undefined) return firstPage(page, at);
  const polledIds = new Set(page.items.map((item) => item.emailId));
  // `compareKey(item, last) > 0` means `item` is older than `last`.
  const keep = state.items.filter((item) => compareKey(item, last) > 0 && !polledIds.has(item.emailId));
  return {
    ...state,
    items: [...page.items, ...keep],
    status: "ready",
    refreshError: false,
    lastLoad: at,
  };
}

export function startLoadMore(state: ActivityListState): { state: ActivityListState; cursor: string } | null {
  if (state.loadingMore || state.nextBefore === null) return null;
  return { state: { ...state, loadingMore: true }, cursor: state.nextBefore };
}

export function appendOlder(state: ActivityListState, page: ActivityWebPage, sentCursor: string): ActivityListState {
  if (state.nextBefore !== sentCursor) return { ...state, loadingMore: false };
  const known = new Set(state.items.map((item) => item.emailId));
  return {
    ...state,
    items: [...state.items, ...page.items.filter((item) => !known.has(item.emailId))],
    nextBefore: page.nextBefore,
    olderLoaded: true,
    loadingMore: false,
  };
}

export function loadMoreFailed(state: ActivityListState): ActivityListState {
  return { ...state, loadingMore: false };
}

export function patchItem(
  state: ActivityListState,
  emailId: string,
  patch: Partial<Pick<ActivityItem, "feedback" | "undoable" | "undoPending">>
): ActivityListState {
  if (!state.items.some((item) => item.emailId === emailId)) return state;
  return { ...state, items: state.items.map((item) => (item.emailId === emailId ? { ...item, ...patch } : item)) };
}
