import { createLog } from "../../platform/log";

const log = createLog("triage");

// A pause of the LLM client in this process. The quota is per project, so one pause covers all mailboxes.
export interface LlmPause {
  // Starts a pause and returns its end. Each trip since the last `reset` doubles the length, up to `maxMs`.
  trip(kind: "soft" | "config", code: string, now: Date): Date;
  isPaused(now: Date): boolean;
  // A call got an answer: the next trip starts at `baseMs` again.
  reset(): void;
}

export function createLlmPause(opts: { baseMs?: number; maxMs?: number; configHint?: string } = {}): LlmPause {
  const baseMs = opts.baseMs ?? 5 * 60_000;
  const maxMs = opts.maxMs ?? 60 * 60_000;
  const configHint = opts.configHint ?? "check the LLM API key, the classifier model and the provider project";
  let trips = 0;
  let until: Date | null = null;

  return {
    trip(kind, code, now) {
      trips += 1;
      const ms = Math.min(baseMs * 2 ** (trips - 1), maxMs);
      until = new Date(now.getTime() + ms);
      const minutes = Math.round(ms / 60_000);
      if (kind === "soft") {
        log.warn(`LLM soft error ${code}: triage paused for ${minutes} min, until ${until.toISOString()}`);
      } else {
        log.error(
          `LLM config error ${code}: ${configHint}; triage paused for ${minutes} min, until ${until.toISOString()}`
        );
      }
      return until;
    },
    isPaused(now) {
      return until !== null && now.getTime() < until.getTime();
    },
    reset() {
      trips = 0;
    },
  };
}
