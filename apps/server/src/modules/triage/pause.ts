import { HOUR_MS, MINUTE_MS } from "@ea/core";

import { createLog } from "../../platform/log";

const log = createLog("triage");

// A pause of the LLM client in this process. The quota is per project, so one pause covers all mailboxes.
export interface LlmPause {
  // Starts a pause and returns its end. Each trip since the last `reset` doubles the length, up to `maxMs`.
  trip(kind: "soft" | "config", code: string, now: Date): Date;
  isPaused(now: Date): boolean;
  // The end of the current pause, or null when none runs or it has ended (the history check waits until then).
  pausedUntil(now: Date): Date | null;
  // The time of the first trip of the current run of pauses (the trips since the last `reset`), or null. Only `reset`
  // clears it: a pause that grew from 5 to 10 min is one run.
  pausedSince(): Date | null;
  // A call got an answer: the next trip starts at `baseMs` again.
  reset(): void;
}

export function createLlmPause(opts: { baseMs?: number; maxMs?: number } = {}): LlmPause {
  const baseMs = opts.baseMs ?? 5 * MINUTE_MS;
  const maxMs = opts.maxMs ?? HOUR_MS;
  let trips = 0;
  let until: Date | null = null;
  let since: Date | null = null;

  return {
    trip(kind, code, now) {
      trips += 1;
      if (since === null) since = now;
      const ms = Math.min(baseMs * 2 ** (trips - 1), maxMs);
      until = new Date(now.getTime() + ms);
      if (kind === "soft") {
        log.warn("llm_paused", { code, wait_ms: ms, until: until.toISOString() });
      } else {
        // The hint text is not logged: docs/known-alerts.md keeps it per code.
        log.error("llm_config_paused", { code, wait_ms: ms, until: until.toISOString() });
      }
      return until;
    },
    isPaused(now) {
      return until !== null && now.getTime() < until.getTime();
    },
    pausedUntil(now) {
      return until !== null && now.getTime() < until.getTime() ? until : null;
    },
    pausedSince() {
      return since;
    },
    reset() {
      trips = 0;
      since = null;
    },
  };
}
