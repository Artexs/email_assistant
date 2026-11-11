import { useCallback, useEffect, useRef, useState } from "react";

import { fetchActivity } from "./activity-api";
import {
  appendOlder,
  firstPage,
  INITIAL_LIST,
  loadMoreFailed,
  mergePolled,
  patchItem,
  startLoadMore,
  type ActivityListState,
} from "./activity-list";
import { startPolling } from "./poll";

export function useActivityList(
  queryOf: (before?: string) => string,
  opts: { pollMs?: number; onLoadMoreError?: () => void } = {}
) {
  const { pollMs = 30_000 } = opts;
  const queryRef = useRef(queryOf);
  const errorRef = useRef(opts.onLoadMoreError);
  // The newest state, so loadMore() reads it outside a render.
  const stateRef = useRef<ActivityListState>(INITIAL_LIST);
  const [state, setState] = useState<ActivityListState>(INITIAL_LIST);
  const [tick, setTick] = useState(0);
  // A first-page answer counts only when no newer load, refresh or patch came after it started.
  const seqRef = useRef(0);
  // A load-more answer counts unless a refresh (or an unmount) came after it started; a poll does not count.
  const moreSeqRef = useRef(0);
  // "first": the next answer replaces the list (first load, refresh). "poll": it merges.
  const modeRef = useRef<"first" | "poll">("first");

  useEffect(() => {
    queryRef.current = queryOf;
    errorRef.current = opts.onLoadMoreError;
  });

  const apply = useCallback((change: (prev: ActivityListState) => ActivityListState) => {
    stateRef.current = change(stateRef.current);
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    let active = true;

    const run = () => {
      seqRef.current += 1;
      const seq = seqRef.current;
      fetchActivity(queryRef.current())
        .then((page) => {
          if (!active || seq !== seqRef.current) return;
          const at = new Date();
          const mode = modeRef.current;
          modeRef.current = "poll";
          apply((prev) => (mode === "first" ? firstPage(page, at) : mergePolled(prev, page, at)));
        })
        .catch(() => {
          if (!active || seq !== seqRef.current) return;
          apply((prev) =>
            prev.items.length > 0 ? { ...prev, refreshError: true } : { ...prev, status: "error", refreshError: false }
          );
        });
    };

    const stop = startPolling(run, {
      pollMs,
      doc: document,
      timers: {
        setInterval: (handler, ms) => setInterval(handler, ms),
        clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
      },
    });
    return () => {
      active = false;
      moreSeqRef.current += 1;
      stop();
    };
    // `tick` restarts the loop on refresh(); `queryOf` is read through the ref.
  }, [pollMs, tick, apply]);

  const refresh = useCallback(() => {
    modeRef.current = "first";
    seqRef.current += 1;
    moreSeqRef.current += 1;
    apply((prev) => ({ ...prev, loadingMore: false, status: prev.items.length === 0 ? "loading" : prev.status }));
    setTick((n) => n + 1);
  }, [apply]);

  const loadMore = useCallback(() => {
    const started = startLoadMore(stateRef.current);
    if (started === null) return;
    apply(() => started.state);
    const moreSeq = moreSeqRef.current;
    fetchActivity(queryRef.current(started.cursor))
      .then((page) => {
        if (moreSeq !== moreSeqRef.current) return;
        apply((prev) => appendOlder(prev, page, started.cursor));
      })
      .catch(() => {
        if (moreSeq !== moreSeqRef.current) return;
        apply(loadMoreFailed);
        errorRef.current?.();
      });
  }, [apply]);

  const patch = useCallback(
    (emailId: string, change: Parameters<typeof patchItem>[2]) => {
      seqRef.current += 1;
      apply((prev) => patchItem(prev, emailId, change));
    },
    [apply]
  );

  return { state, refresh, loadMore, patch };
}
