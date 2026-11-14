import { useEffect, useRef } from "react";

// Calls `reload` when `dep` changes. The first render does nothing: the resource loads itself.
export function useReloadOn(dep: unknown, reload: () => void): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
    // `reload` is stable in `useResource`, so only `dep` triggers a reload.
  }, [dep, reload]);
}
