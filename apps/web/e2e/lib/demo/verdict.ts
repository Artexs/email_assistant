// The last line of `bun run demo:record` and the check of the model hosts. Pure: the command fills the inputs.

/** The first seed day whose export holds a full week of triage: an earlier day is a trial seed. */
export const MIN_UPLOAD_SEED_DAY = 5;

export const UPLOAD_CANDIDATE = "demo_source demo: upload candidate";

export interface VerdictInput {
  source: "e2e" | "demo";
  exitCode: number;
  /** The `day` of the parsed seed; null when the run never read one. */
  seedDay: number | null;
  gateProvisional: boolean;
  misses: number;
  /** The ids of the steps that are not live in this source. */
  notLive: string[];
  llmChecked: boolean;
}

/**
 * One line that says whether the run makes a video for upload. It names the first failing reason, in a fixed order, and never
 * says "upload candidate" for a run that failed.
 */
export function uploadVerdict(input: VerdictInput): string {
  const reason = firstReason(input);
  return reason === null ? UPLOAD_CANDIDATE : `not for upload: ${reason}`;
}

function firstReason(input: VerdictInput): string | null {
  if (input.exitCode !== 0) return "run_failed";
  if (input.source !== "demo") return "e2e_source";
  if (input.seedDay === null || input.seedDay < MIN_UPLOAD_SEED_DAY) return "trial_seed";
  if (input.gateProvisional) return "gate_provisional";
  if (input.misses > 0) return "replay_miss";
  if (!input.llmChecked) return "llm_unchecked";
  if (input.notLive.length > 0) return "not_live";
  return null;
}

export interface ModelCheckInput {
  /** The lines of the run output. */
  lines: string[];
  /** Answers the replay server gave. */
  hits: number;
  /** Calls the run must make: the history mails plus the live mails. */
  expectedHits: number;
}

// The settings line of the server (`log.info("llm_settings", …)`): JSON, or text with `key=value` pairs. A web server line may carry a prefix.
function settingsOf(line: string): { endpoint: string | undefined; host: string | undefined } {
  const start = line.indexOf("{");
  if (start >= 0) {
    try {
      const fields = JSON.parse(line.slice(start)) as { endpoint?: unknown; host?: unknown };
      return {
        endpoint: typeof fields.endpoint === "string" ? fields.endpoint : undefined,
        host: typeof fields.host === "string" ? fields.host : undefined,
      };
    } catch {
      return { endpoint: undefined, host: undefined };
    }
  }
  return { endpoint: /\bendpoint=(\S+)/.exec(line)?.[1], host: /\bhost=(\S+)/.exec(line)?.[1] };
}

/**
 * null when every model setting line of the servers names the own endpoint on 127.0.0.1 and the replay answered every expected call.
 * Else `demo_llm_unchecked`: a run with no such line proved nothing about the host.
 */
export function modelCheck({ lines, hits, expectedHits }: ModelCheckInput): string | null {
  const settings = lines.filter((line) => line.includes("llm_settings")).map(settingsOf);
  const loopback = settings.length > 0 && settings.every((s) => s.endpoint === "own" && s.host === "127.0.0.1");
  return loopback && hits >= expectedHits ? null : "demo_llm_unchecked";
}
