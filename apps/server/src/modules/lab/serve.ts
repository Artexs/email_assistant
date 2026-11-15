import { localToInstant, nextLocalDate } from "@ea/core";

import { FakeTgError } from "./fake-tg";
import { LabMailError } from "./mail-client";
import type { ServeLock, ServeStatus } from "./serve-files";
import { writeRunLedgerLine } from "./start";
import type { LabState } from "./state";

// The serve loop: every active run goes through one tick after another, every `everyMs`. The parts of a tick are the
// functions of the earlier stages (injector, bots, executive); each is idempotent, so a restart resumes from the events.
// One serve process per state directory (the serve lock) is what makes the three writers safe: two ticks at the same
// time would both send a due mail, a reply or a tap.

const ZONE = "Europe/Warsaw";
/** The tenth failure in a row of one part of one run stops the run. */
export const MAX_PART_FAILURES = 10;
export const SERVE_EVERY_MS = 30_000;

export type FinishReason = "done" | "budget" | `error:${string}`;

export interface ServeParts {
  /** Demo runs: switches the mailbox to assist on the planned day. */
  mode: (runId: string) => Promise<void>;
  injector: (runId: string) => Promise<{ stopped?: "budget" }>;
  bots: (runId: string) => Promise<{ failed: number }>;
  executive: (runId: string) => Promise<unknown>;
  /** The only way a serve tick stops a run: the ledger line first, then `stopRun`. */
  finish: (runId: string, reason: FinishReason) => Promise<void>;
}

export interface ServeDeps {
  state: LabState;
  parts: ServeParts;
  now: () => Date;
  spendUsd: (runId: string) => Promise<number | "unpriced">;
  /** One line for the operator: ids, codes and counts only. */
  say: (line: string) => void;
  /** Called at the end of each tick with the counts for `serve.json`. */
  heartbeat?: (status: ServeStatus) => void;
  signal?: AbortSignal;
}

/**
 * Ends a run for the serve loop. The ledger line comes first: a crash between the two writes leaves an active run that the
 * next tick ends, never a stopped run with no line (the month cap would not see its spend). A repeated call adds no line.
 */
export function finishRun(state: LabState, runId: string, reason: FinishReason, usd: number, now: Date): void {
  writeRunLedgerLine(state, runId, usd, now, `lab-01-live-${reason.split(":")[0]}`);
  state.stopRun(runId, reason);
}

const PART_KEY = (runId: string, part: string): string => `${runId}:${part}`;

/**
 * A short code of an error for the operator line. Only three sources: a lab mail error (its own code), a fake Telegram
 * error, and a system error code such as `ECONNREFUSED`. Anything else is `unknown`: never a message, never a free text.
 */
export function errorCodeOf(error: unknown): string {
  if (error instanceof LabMailError) return error.code;
  if (error instanceof FakeTgError) return `fake_tg_${error.status}`;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^E[A-Z0-9]{2,20}$/.test(code) ? code : "unknown";
}

// The runs a tick handles: a run folder without a `stopped` event.
const activeRunIds = (state: LabState): string[] =>
  state.listRuns().filter((runId) => !state.events(runId).some((event) => event.t === "stopped"));

/**
 * The demo mode switch. A run with a `modePlan` sets the mailbox to `assist` once, from 00:00 Warsaw of day
 * `assistFromDay` of the run (day 1 is the start date). `setAssist` must be safe to call twice: a crash between it and
 * the `mode` event runs it again.
 */
export async function runModeStep(
  deps: { state: LabState; now: () => Date; setAssist: (runId: string) => Promise<void> },
  runId: string
): Promise<void> {
  const { state } = deps;
  const run = state.readRun(runId);
  if (run.modePlan === undefined) return;
  if (state.events(runId).some((event) => event.t === "mode" && event.mode === "assist")) return;
  let date = run.plan.startDate;
  for (let day = 1; day < run.modePlan.assistFromDay; day += 1) date = nextLocalDate(date);
  if (deps.now() < localToInstant(date, "00:00", ZONE)) return;
  await deps.setAssist(runId);
  state.append(runId, { t: "mode", mode: "assist" });
}

/**
 * One tick over the active runs. Per run: the spend check, the mode switch, the parts, the end check. A part that
 * throws is counted per run and part (`errors`, kept by the caller between ticks); the loop goes on, and the tenth
 * failure in a row stops the run (`error:<part>`). The first tick of a run reads the executive chat and the bot
 * inboxes first, so the baseline of both exists before the injector sends its first mail.
 */
export async function serveTick(deps: ServeDeps, errors: Map<string, number>): Promise<void> {
  const { state } = deps;
  const active = activeRunIds(state);
  for (const runId of active) {
    if (deps.signal?.aborted) break;
    await tickRun(deps, errors, runId);
  }
  if (deps.heartbeat === undefined) return;
  const runs: ServeStatus["runs"] = {};
  for (const runId of activeRunIds(state)) {
    const counts: Record<string, number> = {};
    for (const [key, count] of errors) {
      if (count > 0 && key.startsWith(`${runId}:`)) counts[key.slice(runId.length + 1)] = count;
    }
    runs[runId] = counts;
  }
  deps.heartbeat({ tickAt: deps.now().toISOString(), runs });
}

type Attempt<T> = { ok: true; value: T } | { ok: false; gaveUp: boolean };

async function tickRun(deps: ServeDeps, errors: Map<string, number>, runId: string): Promise<void> {
  const { state, parts, say } = deps;
  const run = state.readRun(runId);
  // Between parts the loop looks again: a stop by the operator or a signal ends the tick after the part that runs.
  const live = (): boolean =>
    deps.signal?.aborted !== true && !state.events(runId).some((event) => event.t === "stopped");

  async function finish(reason: FinishReason): Promise<void> {
    const done = await attempt("finish", () => parts.finish(runId, reason));
    if (done.ok) say(`finished ${runId} ${reason}`);
  }

  async function attempt<T>(part: string, work: () => Promise<T>): Promise<Attempt<T>> {
    const key = PART_KEY(runId, part);
    try {
      const value = await work();
      errors.delete(key);
      return { ok: true, value };
    } catch (error) {
      const count = (errors.get(key) ?? 0) + 1;
      errors.set(key, count);
      say(`error ${runId} ${part} ${errorCodeOf(error)} ${count}`);
      // `finish` never stops a run for its own failure: it would call itself.
      if (count >= MAX_PART_FAILURES && part !== "finish") {
        await finish(`error:${part}`);
        return { ok: false, gaveUp: true };
      }
      return { ok: false, gaveUp: false };
    }
  }

  const spend = await attempt("spend", () => deps.spendUsd(runId));
  if (!spend.ok) return;
  if (spend.value === "unpriced") return finish("error:unpriced");
  if (spend.value >= run.capUsd) return finish("budget");

  if (!live()) return;
  const moded = await attempt("mode", () => parts.mode(runId));
  if (!moded.ok && moded.gaveUp) return;

  // No `seen` event of the chat yet: the executive has no baseline, so it runs before the injector sends anything.
  const fresh = !state.events(runId).some((event) => event.t === "seen" && event.part === "tg");
  const order = fresh ? (["executive", "bots", "injector"] as const) : (["injector", "bots", "executive"] as const);
  for (const part of order) {
    if (!live()) return;
    const result =
      part === "injector"
        ? await attempt(part, () => parts.injector(runId))
        : part === "bots"
          ? await attempt(part, () => parts.bots(runId))
          : await attempt(part, () => parts.executive(runId));
    if (!result.ok) {
      if (result.gaveUp) return;
      // Without the baseline no mail goes out: the next tick tries the executive again.
      if (fresh && part === "executive") return;
      continue;
    }
    if (part === "injector" && (result.value as { stopped?: "budget" }).stopped === "budget") return finish("budget");
    if (part === "bots") {
      const failed = (result.value as { failed: number }).failed;
      if (failed > 0) errors.set(PART_KEY(runId, "bots_failed"), failed);
      else errors.delete(PART_KEY(runId, "bots_failed"));
    }
  }

  if (live() && deps.now() >= new Date(run.plan.tailEndsAt)) await finish("done");
}

export interface ServeRunDeps extends Omit<ServeDeps, "signal"> {
  /** Issue codes of `checkSimEnv`; any code refuses the start. */
  envIssues: () => readonly string[];
  /** The serve lock; `undefined` when another serve process holds it. */
  takeLock: () => ServeLock | undefined;
  /** Resolves after `ms`, or at once when the signal aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  heartbeatEveryMs: number;
}

/**
 * The long-lived process. Returns the exit code: 1 for a bad env or a second serve process (before any tick, so
 * nothing is written), 0 after a signal. The signal ends the tick after the part that runs.
 */
export async function runServe(deps: ServeRunDeps, opts: { everyMs: number; signal: AbortSignal }): Promise<number> {
  const issues = deps.envIssues();
  if (issues.length > 0) {
    deps.say(`refused: env is not the sim stack: ${issues.join(", ")}`);
    return 1;
  }
  const lock = deps.takeLock();
  if (lock === undefined) {
    deps.say("refused: serve_running");
    return 1;
  }
  // The lock file time is the proof of life for a second container that shares the state volume.
  const beat = setInterval(() => lock.touch(), deps.heartbeatEveryMs);
  try {
    deps.say(`serve started every ${opts.everyMs} ms`);
    const errors = new Map<string, number>();
    while (!opts.signal.aborted) {
      lock.touch();
      try {
        await serveTick({ ...deps, signal: opts.signal }, errors);
      } catch (error) {
        // A failure outside the parts (a state file): logged, and the loop goes on.
        deps.say(`error serve tick ${errorCodeOf(error)}`);
      }
      if (opts.signal.aborted) break;
      await deps.sleep(opts.everyMs, opts.signal);
    }
    deps.say("serve stopped");
    return 0;
  } finally {
    clearInterval(beat);
    lock.release();
  }
}
