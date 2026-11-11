import { useCallback, useEffect, useRef, useState } from "react";

import { startPolling } from "./poll";

interface ResourceState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

export function useResource<T>(load: () => Promise<T>, opts: { pollMs?: number } = {}) {
  const { pollMs = 30_000 } = opts;
  const loadRef = useRef(load);
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  // A load answer counts only when no newer load or `mutate` came after it started.
  const seqRef = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setTick((n) => n + 1);
  }, []);

  const mutate = useCallback((data: T) => {
    seqRef.current += 1;
    setState({ data, error: null, loading: false });
  }, []);

  useEffect(() => {
    let active = true;

    const run = () => {
      seqRef.current += 1;
      const seq = seqRef.current;
      loadRef
        .current()
        .then((data) => {
          if (active && seq === seqRef.current) setState({ data, error: null, loading: false });
        })
        .catch((error: unknown) => {
          if (active && seq === seqRef.current) setState((prev) => ({ data: prev.data, error, loading: false }));
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
      stop();
    };
    // `tick` restarts the loop on reload(); `load` is read through the ref, so it is not a dependency.
  }, [pollMs, tick]);

  return { ...state, reload, mutate };
}
