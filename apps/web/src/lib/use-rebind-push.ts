import { useEffect } from "react";

import { browserPushDeps } from "./push-api";
import { pushSupported, rebindPush, type PushFlowDeps, type RebindResult } from "./push-client";

// Once per page load, with `web_push` on: an existing subscription of this browser follows the new session (`rebindOnly`: it never
// adds a device). A failure is silent (the browser console already shows a failed request; nothing of the subscription is logged).
let rebound = false;

/** Test only: a new page load. */
export function resetRebindForTest(): void {
  rebound = false;
}

/** The one re-bind of this page load; null when it does not run (flag off, no browser support, or it ran already). */
export function startRebind(enabled: boolean, supported: boolean, deps: PushFlowDeps): Promise<RebindResult> | null {
  if (!enabled || !supported || rebound) return null;
  rebound = true;
  return rebindPush(deps);
}

export function useRebindPush(enabled: boolean): void {
  useEffect(() => {
    void startRebind(enabled, pushSupported(globalThis), browserPushDeps());
  }, [enabled]);
}
