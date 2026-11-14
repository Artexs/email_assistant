import { meSchema, type Me } from "@ea/core/web";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { api } from "../../lib/api";
import { useResource } from "../../lib/use-resource";

export interface MeState {
  me: Me | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

// Exported so a render test can supply `me` without the `/api/me` request.
export const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, reload } = useResource(() => api("/api/me", meSchema), { pollMs: 30_000 });
  const value = useMemo<MeState>(() => ({ me: data, error, loading, reload }), [data, error, loading, reload]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const value = useContext(MeContext);
  if (value === null) throw new Error("useMe needs a MeProvider");
  return value;
}
