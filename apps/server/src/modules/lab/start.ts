import {
  checkSimEnv,
  costPerMail,
  localDateTime,
  nextLocalDate,
  planLiveRun,
  type LiveMode,
  type SimEnvIssue,
} from "@ea/core";

import { appendLedgerLine, ledgerLine, readLedger } from "../../platform/eval-ledger";

import type { LabCorpus } from "./corpus";
import { labAddresses } from "./corpus";
import type { LabOrgKey, LabRun, LabState } from "./state";

const ZONE = "Europe/Warsaw";

// The default cap of a run (USD). A request above it is refused, not clamped: the month clamp is `capFor`.
export const DEFAULT_CAP_USD: Record<LiveMode, number> = { day: 1, week: 5 };

export type StartRefusal =
  | "not_seeded"
  | "not_monday"
  | "dst_change"
  | "bad_date"
  | "cap_too_high"
  | "month_cap"
  | "model_unpriced"
  | "org_not_fresh"
  | "run_active";

export interface StartInput {
  mode: LiveMode;
  org: LabOrgKey;
  date?: string;
  capUsd?: number;
  reuse: boolean;
}

export interface StartDeps {
  state: LabState;
  corpus: LabCorpus;
  // The models the stack is configured to call. The caller names the roles the lab uses.
  models: readonly string[];
  orgHasMail(orgId: string): Promise<boolean>;
  now(): Date;
  hex4(): string;
}

export type StartResult = { kind: "started"; run: LabRun } | { kind: "refused"; code: StartRefusal; detail?: string };

const refuse = (code: StartRefusal, detail?: string): StartResult => ({
  kind: "refused",
  code,
  ...(detail === undefined ? {} : { detail }),
});

// A date is a Monday when its UTC weekday (from the date parts, no zone shift) is 1.
function isMonday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

/** Tomorrow in Warsaw; for a week run, the first Monday after today. */
export function defaultStartDate(mode: LiveMode, now: Date): string {
  let date = nextLocalDate(localDateTime(now, ZONE).date);
  if (mode === "week") while (!isMonday(date)) date = nextLocalDate(date);
  return date;
}

// The checks run from the cheapest to the dearest. Nothing is written until every check has passed; the lock
// comes first in `startRun`, so a refused second start leaves no run folder.
export async function startLabRun(input: StartInput, deps: StartDeps): Promise<StartResult> {
  const { state, corpus } = deps;
  const org = state.readOrgs()[input.org];
  if (org === undefined) return refuse("not_seeded");

  const requested = input.capUsd ?? DEFAULT_CAP_USD[input.mode];
  if (requested > DEFAULT_CAP_USD[input.mode]) return refuse("cap_too_high");

  const hex4 = deps.hex4();
  const startDate = input.date ?? defaultStartDate(input.mode, deps.now());
  const plan = planLiveRun({
    scenario: corpus.scenario,
    slots: [...corpus.slots.values()],
    mode: input.mode,
    startDate,
    runId: `${input.mode}-${startDate.replaceAll("-", "")}-${hex4}`,
  });
  if ("refused" in plan) return refuse(plan.refused);

  // The ledger gets a line only when a run ends, so the caps of the active runs count as spent (`capFor`).
  const capUsd = state.capFor(requested);
  if (capUsd <= 0) return refuse("month_cap");

  // A call with no price would count $0 toward the cap. The stack must not hold such a model.
  const unpriced = [...new Set(deps.models)].filter((model) => costPerMail(model, 0, 0, deps.now()) === null);
  if (unpriced.length > 0) return refuse("model_unpriced", unpriced.join(","));

  if (!input.reuse && (await deps.orgHasMail(org.orgId))) return refuse("org_not_fresh");

  const run: LabRun = { plan, org: input.org, capUsd };
  if (state.startRun(run) === "run_active") return refuse("run_active");
  return { kind: "started", run };
}

export const labEnvIssues = (env: Record<string, string | undefined>, corpus: LabCorpus): SimEnvIssue[] =>
  checkSimEnv(env, labAddresses(corpus));

// One ledger line per run: a second call, or a serve loop that wrote the line first, adds none. Returns true when it wrote.
export function writeRunLedgerLine(state: LabState, runId: string, usd: number, now: Date, label: string): boolean {
  const written = readLedger(state.ledgerPath())
    .split("\n")
    .some((line) => {
      try {
        return (JSON.parse(line) as { runId?: unknown }).runId === runId;
      } catch {
        return false;
      }
    });
  if (written) return false;
  appendLedgerLine(state.ledgerPath(), ledgerLine({ runId, at: now, usd, label }));
  return true;
}

// The operator stop. `stopRun` is the only writer of `stopped` and it is safe to call twice; the ledger line follows.
export function stopLabRun(state: LabState, runId: string, usd: number, now: Date): { ledgerWritten: boolean } {
  state.stopRun(runId, "operator");
  return { ledgerWritten: writeRunLedgerLine(state, runId, usd, now, "lab-01-live-operator") };
}
