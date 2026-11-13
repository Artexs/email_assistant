import { errorFields } from "./errors";
import { createLog } from "./log";

const log = createLog("heartbeat");

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HeartbeatDeps {
  url: string | undefined;
  checkDb: () => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Pings the dead-man's-switch URL while the DB answers. The URL is a secret token: it is never logged. */
export function createHeartbeat(deps: HeartbeatDeps): { tick(): Promise<void> } {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async tick() {
      const url = deps.url;
      if (url === undefined) return;
      try {
        if (!(await deps.checkDb())) {
          log.warn("heartbeat_db_down");
          return;
        }
        const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) log.warn("heartbeat_ping_failed", { status: response.status });
      } catch (error) {
        // A fetch error message can hold the secret URL: log the name and code only.
        log.warn("heartbeat_ping_failed", { ...errorFields(error) });
      }
    },
  };
}
