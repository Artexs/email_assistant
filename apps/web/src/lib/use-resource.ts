import { useCallback, useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = () => {
      loadRef
        .current()
        .then((data) => {
          if (active) setState({ data, error: null, loading: false });
        })
        .catch((error: unknown) => {
          if (active) setState((prev) => ({ data: prev.data, error, loading: false }));
        });
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (pollMs !== undefined) timer = setInterval(run, pollMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
        start();
      } else {
        stop();
      }
    };

    run();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `tick` restarts the loop on reload(); `load` is read through the ref, so it is not a dependency.
  }, [pollMs, tick]);

  return { ...state, reload };
}
