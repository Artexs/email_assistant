import { useCallback, useEffect, useState } from "react";

function readId(): string | null {
  const id = new URLSearchParams(location.search).get("id");
  return id === null || id === "" ? null : id;
}

// The selection of a page is the `id` query parameter: `/approvals?id=<uuid>`. A choice pushes a history entry (the back button
// returns to the list); `replace` swaps the entry (a redirect to a newer version). Browser back and forward update the value.
export function useSelectedId() {
  const [id, setId] = useState<string | null>(readId);

  useEffect(() => {
    const onPop = () => setId(readId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((next: string | null, mode: "push" | "replace" = "push") => {
    const url = next === null ? location.pathname : `${location.pathname}?id=${encodeURIComponent(next)}`;
    if (mode === "replace") history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setId(next);
  }, []);

  return [id, select] as const;
}
